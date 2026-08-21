// components/PipelineFlowEditor.tsx — workflowbuilder 可视化流水线编辑器（路线A）
//
// 数据流：
//   PipelineDef.dag（后端真源）→ initialNodes/initialEdges → WorkflowBuilder.Root
//   编辑器 onDataSave（props 策略）→ 转回 PipelineDag → PUT /api/pipelines/:id/dag
//   后端校验 + 编译出 steps → 引擎照旧执行
//
// 节点类型（5 种）：trigger / agent / decision / loop / delay
// loop 语义：body 节点带 loopOf、出口节点带 exitOf（域标记，不画回边）

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WorkflowBuilder,
  sharedProperties,
  NodeType,
  setStoreNodes,
  setStoreEdges,
  getScope,
  globalControls,
  type PaletteItem,
  type NodeSchema,
  type UISchema,
  type WorkflowBuilderNode,
  type WorkflowBuilderEdge,
  type WorkflowBuilderIsValidConnection,
} from "@workflowbuilder/sdk";
import "@workflowbuilder/sdk/style.css";
import type { PipelineDef } from "../stores/pipelines";

// ── 5 种节点 schema ──

const agentSchema = {
  type: "object",
  required: ["label"],
  properties: {
    ...sharedProperties,
    role: { type: "string", label: "角色", description: "注入 prompt 的角色名" },
    instructions: { type: "string", label: "专属指令", description: "本步骤的详细指令" },
    inputsFrom: {
      type: "string",
      label: "输入来源",
      description: "all = 全部上游；或逗号分隔的节点 id",
    },
    maxRetries: { type: "number", label: "重试次数", description: "0-3" },
    artifacts: { type: "string", label: "产物文件", description: "逗号分隔的 glob（相对 cwd）" },
    needsUserInput: { type: "boolean", label: "人工闸门", description: "执行前等待人工确认" },
    verdictType: { type: "string", label: "裁决类型", description: "pass-fail 或 route（逗号分隔路由值）" },
    verdictCommand: { type: "string", label: "裁决命令", description: "确定性命令（如 pnpm test），exit 0 = pass" },
    verdictHint: { type: "string", label: "裁决提示", description: "LLM 通道：要求输出末尾 json verdict" },
  },
} as unknown as NodeSchema;

const decisionSchema = {
  type: "object",
  required: ["label"],
  properties: {
    ...sharedProperties,
    sourceNodeId: { type: "string", label: "数据源节点 id", description: "引用哪个 agent 节点的 verdict" },
  },
} as unknown as NodeSchema;

const loopSchema = {
  type: "object",
  required: ["label"],
  properties: {
    ...sharedProperties,
    loopType: { type: "string", label: "循环类型", description: "dountil（满足停）或 dowhile（满足继续）" },
    maxIterations: { type: "number", label: "最大轮次", description: "1-5" },
  },
} as unknown as NodeSchema;

const delaySchema = {
  type: "object",
  required: ["label"],
  properties: {
    ...sharedProperties,
    durationMs: { type: "number", label: "等待毫秒", description: "0 - 3600000" },
  },
} as unknown as NodeSchema;

const triggerSchema = {
  type: "object",
  required: ["label"],
  properties: { ...sharedProperties },
} as unknown as NodeSchema;

// ── 5 种节点 uischema（属性面板控件布局；没有 uischema 面板不渲染控件） ──

const F = (scope: string, label: string, extra?: Record<string, unknown>) =>
  ({ type: "Text", scope, label, ...extra }) as const;

const agentUischema: UISchema = {
  type: "VerticalLayout",
  elements: [
    ...globalControls,
    F("#/properties/role", "角色"),
    F("#/properties/instructions", "专属指令", { options: { multi: true } }),
    F("#/properties/inputsFrom", "输入来源"),
    { type: "VerticalLayout", elements: [
      F("#/properties/maxRetries", "重试次数"),
      { type: "Switch", scope: "#/properties/needsUserInput", label: "人工闸门" },
    ] },
    F("#/properties/artifacts", "产物文件"),
    { type: "Accordion", label: "裁决 Verdict", elements: [
      F("#/properties/verdictType", "裁决类型"),
      F("#/properties/verdictCommand", "裁决命令"),
      F("#/properties/verdictHint", "裁决提示", { options: { multi: true } }),
    ] },
  ],
} as unknown as UISchema;

const decisionUischema: UISchema = {
  type: "VerticalLayout",
  elements: [
    ...globalControls,
    F("#/properties/sourceNodeId", "数据源节点 id"),
  ],
} as unknown as UISchema;

const loopUischema: UISchema = {
  type: "VerticalLayout",
  elements: [
    ...globalControls,
    F("#/properties/loopType", "循环类型"),
    F("#/properties/maxIterations", "最大轮次"),
  ],
} as unknown as UISchema;

const delayUischema: UISchema = {
  type: "VerticalLayout",
  elements: [
    ...globalControls,
    F("#/properties/durationMs", "等待毫秒"),
  ],
} as unknown as UISchema;

const triggerUischema: UISchema = {
  type: "VerticalLayout",
  elements: [...globalControls],
} as unknown as UISchema;

// ── Palette 定义（模块级：stable reference）──

const agentNode: PaletteItem<typeof agentSchema> = {
  type: "agent",
  icon: "Robot",
  templateType: NodeType.Node,
  label: "Agent 步骤",
  description: "LLM 执行单元：角色+指令+裁决",
  schema: agentSchema,
  uischema: agentUischema,
  defaultPropertiesData: {
    label: "新步骤",
    role: "执行者",
    inputsFrom: "all",
    maxRetries: 0,
    needsUserInput: false,
  } as any,
};

const decisionNode: PaletteItem<typeof decisionSchema> = {
  type: "decision",
  icon: "GitFork",
  templateType: NodeType.DecisionNode,
  label: "条件分支",
  description: "按上游 verdict 路由（出边填匹配值）",
  schema: decisionSchema,
  uischema: decisionUischema,
  defaultPropertiesData: { label: "路由", sourceNodeId: "" } as any,
};

const loopNode: PaletteItem<typeof loopSchema> = {
  type: "loop",
  icon: "ArrowsClockwise",
  templateType: NodeType.Node,
  label: "循环域",
  description: "body 节点拖入域内（loopOf），出口标 exitOf",
  schema: loopSchema,
  uischema: loopUischema,
  defaultPropertiesData: { label: "循环", loopType: "dountil", maxIterations: 2 } as any,
};

const delayNode: PaletteItem<typeof delaySchema> = {
  type: "delay",
  icon: "Clock",
  templateType: NodeType.Node,
  label: "等待",
  description: "sleep 指定毫秒",
  schema: delaySchema,
  uischema: delayUischema,
  defaultPropertiesData: { label: "等待", durationMs: 1000 } as any,
};

const triggerNode: PaletteItem<typeof triggerSchema> = {
  type: "trigger",
  icon: "Play",
  templateType: NodeType.StartNode,
  label: "起点",
  description: "流水线入口（唯一）",
  schema: triggerSchema,
  uischema: triggerUischema,
  defaultPropertiesData: { label: "开始" } as any,
};

const NODE_TYPES: PaletteItem[] = [triggerNode, agentNode, decisionNode, loopNode, delayNode];

// ── 连接校验：trigger 只出不进；环由保存时后端校验 ──
const isValidConnection: WorkflowBuilderIsValidConnection = ({ sourceNode, targetNode }) => {
  if (!sourceNode || !targetNode) return true;
  if (targetNode.data.type === "trigger") return false;
  if (sourceNode.id === targetNode.id) return false;
  return true;
};

// ── DAG ↔ 编辑器格式转换 ──

interface DagNodeShape {
  id: string;
  type: string;
  label: string;
  [k: string]: unknown;
}

/** 自定义类型 → SDK templateType（ReactFlow 节点渲染器键，缺了就报 "Instances of undefined type"） */
function templateFor(type: string): "start-node" | "decision-node" | "node" {
  switch (type) {
    case "trigger": return "start-node";
    case "decision": return "decision-node";
    default: return "node"; // agent / loop / delay
  }
}

function dagToEditor(dag: { positions: Record<string, { x: number; y: number }>; nodes: DagNodeShape[]; edges: any[] }) {
  const nodes: WorkflowBuilderNode[] = dag.nodes.map((n) => ({
    id: n.id,
    type: templateFor(n.type),           // ReactFlow 渲染器类型（必须）
    position: dag.positions[n.id] ?? { x: 100, y: 200 },
    data: {
      type: n.type,                       // palette 键（属性面板按它找 schema）
      templateType: templateFor(n.type), // SDK NodeType
      icon: iconFor(n.type),
      properties: nodeToProperties(n),
    },
  })) as any;
  const edges: WorkflowBuilderEdge[] = dag.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.isDefault ? "default" : e.branchValue,
  })) as any;
  return { nodes, edges };
}

/** 安全属性组装：值为 undefined 的键一律不写入
 *  （@cfworker/json-schema 校验器遇到 undefined 值直接抛 "Instances of undefined type"） */
function put(base: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined) base[key] = value;
}

function nodeToProperties(n: DagNodeShape): Record<string, unknown> {
  const base: Record<string, unknown> = { label: n.label };
  switch (n.type) {
    case "agent":
      put(base, "role", n.role);
      put(base, "instructions", n.instructions);
      base.inputsFrom = Array.isArray(n.inputsFrom) ? n.inputsFrom.join(",") : (n.inputsFrom ?? "all");
      base.maxRetries = (n.retry as any)?.maxRetries ?? 0;
      if (Array.isArray(n.artifacts) && n.artifacts.length) put(base, "artifacts", n.artifacts.join(","));
      base.needsUserInput = n.needsUserInput ?? false;
      if ((n as any).verdict) {
        const v = (n as any).verdict;
        put(base, "verdictType", v.type === "route" ? (v.routes ?? []).join(",") : "pass-fail");
        put(base, "verdictCommand", v.command?.cmd);
        put(base, "verdictHint", v.promptHint);
      }
      break;
    case "decision":
      put(base, "sourceNodeId", n.sourceNodeId);
      break;
    case "loop":
      base.loopType = n.loopType ?? "dountil";
      base.maxIterations = n.maxIterations ?? 2;
      break;
    case "delay":
      base.durationMs = n.durationMs ?? 1000;
      break;
  }
  return base;
}

function editorToDag(nodes: WorkflowBuilderNode[], edges: WorkflowBuilderEdge[], oldDag: { positions: Record<string, { x: number; y: number }>; nodes: DagNodeShape[]; edges: any[] }) {
  const oldById = new Map(oldDag.nodes.map((n) => [n.id, n]));
  const dagNodes: DagNodeShape[] = nodes.map((n) => {
    const p = (n.data?.properties ?? {}) as Record<string, any>;
    const old = oldById.get(n.id);
    const base: DagNodeShape = { id: n.id, type: n.data.type as string, label: p.label || n.id };
    // 保留编辑器不编辑的域标记
    if (old?.loopOf) base.loopOf = old.loopOf;
    if (old?.exitOf) base.exitOf = old.exitOf;
    switch (base.type) {
      case "agent": {
        base.role = p.role || "执行者";
        if (p.instructions) base.instructions = p.instructions;
        base.inputsFrom = typeof p.inputsFrom === "string" && p.inputsFrom.trim() && p.inputsFrom !== "all"
          ? p.inputsFrom.split(",").map((s) => s.trim()).filter(Boolean)
          : "all";
        if (Number(p.maxRetries) > 0) base.retry = { maxRetries: Math.min(3, Number(p.maxRetries)) };
        if (p.artifacts) base.artifacts = String(p.artifacts).split(",").map((s) => s.trim()).filter(Boolean);
        if (p.needsUserInput) base.needsUserInput = true;
        // verdict 重组
        const vt = String(p.verdictType ?? "").trim();
        if (vt === "pass-fail") {
          const v: any = { type: "pass-fail" };
          if (p.verdictCommand) {
            v.command = { cmd: String(p.verdictCommand), passWhen: "pass", failWhen: "fail" };
          }
          if (p.verdictHint) v.promptHint = String(p.verdictHint);
          if (v.command || v.promptHint) base.verdict = v;
        } else if (vt) {
          const routes = vt.split(",").map((s) => s.trim()).filter(Boolean);
          const v: any = { type: "route", routes };
          if (p.verdictHint) v.promptHint = String(p.verdictHint);
          base.verdict = v;
        }
        break;
      }
      case "decision":
        base.sourceNodeId = p.sourceNodeId || "";
        break;
      case "loop":
        base.loopType = p.loopType === "dowhile" ? "dowhile" : "dountil";
        base.maxIterations = Math.max(1, Math.min(5, Number(p.maxIterations) || 2));
        break;
      case "delay":
        base.durationMs = Math.max(0, Math.min(3_600_000, Number(p.durationMs) || 1000));
        break;
    }
    return base;
  });
  const dagEdges = edges.map((e) => {
    const label = (e as any).label as string | undefined;
    if (label === "default") return { id: e.id, source: e.source, target: e.target, isDefault: true };
    if (label) return { id: e.id, source: e.source, target: e.target, branchValue: label };
    return { id: e.id, source: e.source, target: e.target };
  });
  const positions: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) positions[n.id] = { x: n.position.x, y: n.position.y };
  return { positions, nodes: dagNodes, edges: dagEdges };
}

function iconFor(type: string): string {
  return ({ trigger: "Play", agent: "Robot", decision: "GitFork", loop: "ArrowsClockwise", delay: "Clock" } as Record<string, string>)[type] ?? "DotOutline";
}

// ── 组件 ──

export function PipelineFlowEditor({ def, onClose }: { def: PipelineDef; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<{ code: string; message: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const lastSaved = useRef(0);

  const dag = def.dag ?? { positions: {}, nodes: [], edges: [] };
  const initial = useMemo(() => dagToEditor(dag), [def.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // SDK store 是模块级单例：挂载时强制 seed 当前 DAG（防上一次编辑的残留节点），
  // 卸载时清空（防坏数据跨会话存活）
  useEffect(() => {
    setStoreNodes(initial.nodes);
    setStoreEdges(initial.edges);
    return () => {
      setStoreNodes([]);
      setStoreEdges([]);
    };
  }, [def.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = useCallback(async (data: { nodes: WorkflowBuilderNode[]; edges: WorkflowBuilderEdge[] }) => {
    // 防抖：编辑器自动保存频繁，2s 内重复的丢弃
    const now = Date.now();
    if (now - lastSaved.current < 2000) return { status: "success" as const };
    lastSaved.current = now;
    const nextDag = editorToDag(data.nodes, data.edges, dag);
    setSaving(true);
    try {
      const res = await fetch(`/api/pipelines/${def.id}/dag`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dag: nextDag }),
      });
      const json = await res.json();
      if (!res.ok) {
        setIssues(json.issues ?? [{ code: "error", message: json.error }]);
        return { status: "error" as const };
      }
      setIssues([]);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      return { status: "success" as const };
    } catch (e: any) {
      setIssues([{ code: "network", message: e?.message ?? String(e) }]);
      return { status: "error" as const };
    } finally {
      setSaving(false);
    }
  }, [def.id, dag]);

  return (
    <div className="pfe-root">
      <div className="pfe-head">
        <button className="pfe-back" onClick={onClose}>← 返回</button>
        <div className="pfe-title">{def.icon} {def.name}</div>
        <div className="pfe-status">
          {saving && <span className="pfe-saving">保存中…</span>}
          {saved && <span className="pfe-saved">✓ 已保存</span>}
          {issues.length > 0 && <span className="pfe-issue-count">{issues.length} 个问题</span>}
        </div>
      </div>
      {issues.length > 0 && (
        <div className="pfe-issues">
          {issues.map((i, idx) => <div key={idx}>⚠ [{i.code}] {i.message}</div>)}
        </div>
      )}
      <div className="pfe-editor">
        <WorkflowBuilder.Root
          nodeTypes={NODE_TYPES}
          name={def.name}
          layoutDirection="RIGHT"
          initialNodes={initial.nodes}
          initialEdges={initial.edges}
          isValidConnection={isValidConnection}
          integration={{
            strategy: "props",
            onDataSave: async (data) => {
              const r = await handleSave({ nodes: data.nodes, edges: data.edges });
              return r.status;
            },
          }}
        />
      </div>
    </div>
  );
}
