// src/builtin-modes.ts — 8 种内置编排模式定义
//
// 每种模式从真实用户场景出发设计，prompt 模板里的指令足够明确，
// 让主 Agent 能正确理解编排意图并按步骤调用 delegate_task。
//
// 节点标记：每个 delegate_task 的 goal 里嵌入 [team:nodeId] 前缀，
// 运行时前端从 subagent_start 事件的 goal 字段解析 nodeId，
// 驱动 DAG 可视化节点状态联动。

import type { OrchestrationMode } from "./types.ts";

export const BUILTIN_MODES: OrchestrationMode[] = [
  // ── 1. Pipeline 流水线 ──
  {
    id: "pipeline",
    name: "流水线",
    icon: "➡️",
    description: "A → B → C，顺序执行，上一步输出传给下一步",
    detail: "适合有明确先后顺序的任务，如：需求分析 → 开发实现 → 代码审查",
    isBuiltIn: true,
    minMembers: 2,
    topology: "linear",
    layout: "LR",
    promptTemplate: `[团队任务 · 流水线模式] 请按以下步骤依次执行（使用 delegate_task 工具）：

{{members_list}}

执行规则：
- 每一步必须等上一步完成后再开始
- 每步完成后，用 write_blackboard 写入关键产出（author 填角色名，content 填产出摘要）
- 下一步开始前，用 read_blackboard 读取前序步骤的产出，作为 delegate_task 的 context 参数
- 每步的 delegate_task 的 goal 参数开头必须包含 [team:step-N] 标记（N 从 0 开始）
- 最后一步完成后，汇总所有步骤的结果

用户请求：{{user_message}}`,
  },

  // ── 2. Supervisor 主控调度 ──
  {
    id: "supervisor",
    name: "主控调度",
    icon: "🎯",
    description: "Supervisor 智能分解任务，按需调度专家",
    detail: "主 Agent 作为调度中心，分析任务后决定调用哪些专家，可并行",
    isBuiltIn: true,
    minMembers: 2,
    topology: "star",
    layout: "TB",
    promptTemplate: `[团队任务 · 主控调度模式] 你是 Supervisor（主控 Agent），负责分解任务并调度专家 Agent 执行。

可用专家：
{{members_list}}

执行规则：
- 分析用户请求，决定需要调用哪些专家
- 用 delegate_task 依次或并行调用需要的专家 Agent
- goal 参数开头必须包含 [team:worker-N] 标记（N 从 0 开始，对应专家列表序号）
- 如果多个专家的任务互不依赖，可以并行调用
- 收集所有专家的结果后，综合汇总输出给用户
- 不要自己做专业工作，交给专家做

用户请求：{{user_message}}`,
  },

  // ── 3. Evaluator 评估迭代 ──
  {
    id: "evaluator",
    name: "评估迭代",
    icon: "🔄",
    description: "生成 → 评估 → 不达标重试，直到通过",
    detail: "第一个成员负责生成，第二个负责审查评估，不通过则带反馈重试",
    isBuiltIn: true,
    minMembers: 2,
    maxMembers: 3,
    topology: "linear",
    layout: "LR",
    options: [
      { key: "maxRetries", label: "最大重试次数", type: "number", default: 2, min: 1, max: 5 },
    ],
    promptTemplate: `[团队任务 · 评估迭代模式] 请按以下流程执行（使用 delegate_task 工具）：

1. [生成] 调用 delegate_task，goal 开头包含 [team:generator]，让 {{member_0_name}}（{{member_0_role}}）完成用户请求
2. [评估] 调用 delegate_task，goal 开头包含 [team:evaluator]，让 {{member_1_name}}（{{member_1_role}}）审查生成结果
   - 评估标准：正确性、完整性、代码质量（如适用）
   - 输出格式：PASS 或 FAIL + 具体问题列表
3. 如果评估结果为 FAIL：
   - 将评估反馈作为 context，重新调用 {{member_0_name}} 修改
   - 重复步骤 2-3，最多重试 {{max_retries}} 次
4. 评估通过后，{{member_2_nameexists_true}}调用 {{member_2_name}} 做最终整理输出{{member_2_nameexists_false}}输出最终结果

{{member_0_instructions}}{{member_1_instructions}}
执行规则：
- 每次 delegate 是独立的子 Agent 调用
- 评估者必须给出明确的 PASS/FAIL 判断
- 最终输出必须包含所有修改痕迹

用户请求：{{user_message}}`,
  },

  // ── 4. Parallel 并行扇出 ──
  {
    id: "parallel",
    name: "并行扇出",
    icon: "⚡",
    description: "全员并行处理同一任务，结果聚合汇总",
    detail: "所有 Agent 同时独立工作，各自从不同角度解决同一问题，最后合并去重",
    isBuiltIn: true,
    minMembers: 2,
    topology: "fanout",
    layout: "TB",
    promptTemplate: `[团队任务 · 并行模式] 所有专家同时处理同一任务，最后汇总结果。

团队成员：
{{members_list}}

执行规则：
- 用 delegate_task 同时调用所有成员（如果工具支持并行调用则并行，否则快速连续调用）
- 每个 delegate_task 的 goal 开头包含 [team:worker-N] 标记（N 从 0 开始）
- 每个成员独立处理完整任务，互不依赖
- 所有成员完成后，综合汇总各成员的结果，取长补短去重
- 如果成员间结果冲突，选择更可靠的来源并说明理由

用户请求：{{user_message}}`,
  },

  // ── 5. Debate 多轮辩论 ──
  {
    id: "debate",
    name: "多轮辩论",
    icon: "💬",
    description: "多 Agent 多轮辩论，逐步达成共识",
    detail: "适合需要多视角交叉验证的决策场景，如技术选型、方案评审",
    isBuiltIn: true,
    minMembers: 2,
    maxMembers: 4,
    topology: "ring",
    layout: "LR",
    options: [
      { key: "rounds", label: "辩论轮数", type: "number", default: 2, min: 1, max: 5 },
    ],
    promptTemplate: `[团队任务 · 辩论模式] 多个专家进行多轮辩论，最终达成共识。

辩论成员（按发言顺序）：
{{members_list}}

执行规则：
- 共进行 {{options.rounds}} 轮辩论
- 每一轮：按顺序让每个成员发表观点（用 delegate_task，goal 开头包含 [team:debater-N]）
  - 第 1 轮：各自基于用户请求提出初始观点
  - 第 2+ 轮：基于上一轮其他成员的观点进行回应/反驳/补充
  - context 参数包含上一轮所有成员的发言摘要
- 最后一次辩论结束后，综合所有观点，输出共识结论
- 如果未达成完全共识，列出分歧点和各方理由

用户请求：{{user_message}}`,
  },

  // ── 6. Router 路由分发 ──
  {
    id: "router",
    name: "路由分发",
    icon: "🚦",
    description: "路由器分析请求，分派给最佳专家",
    detail: "第一个成员作为路由器分析任务类型，然后只调用最合适的一个专家处理",
    isBuiltIn: true,
    minMembers: 3,
    topology: "star",
    layout: "TB",
    promptTemplate: `[团队任务 · 路由模式] 第一个成员是路由器，负责分析请求并分派给最佳专家。

成员列表：
{{members_list}}

执行规则：
1. [路由分析] 先调用 delegate_task（goal 开头包含 [team:router-0]），
   让 {{member_0_name}}（{{member_0_role}}）分析用户请求，判断应该由哪个专家处理
   - 路由器输出格式：选择专家 N（0-based 序号）+ 理由
2. [专家执行] 根据路由结果，调用 delegate_task（goal 开头包含 [team:worker-N]），
   让选中的专家处理实际任务
3. 输出最终结果（包含路由决策说明）

注意：路由器不解决问题，只做分类判断。实际工作由被选中的专家完成。

用户请求：{{user_message}}`,
  },

  // ── 7. MapReduce 分治 ──
  {
    id: "mapreduce",
    name: "分治聚合",
    icon: "🔬",
    description: "切分任务 → 并行处理 → 汇总归约",
    detail: "第一个成员负责拆分任务，中间成员各自处理子任务，最后一个汇总",
    isBuiltIn: true,
    minMembers: 3,
    topology: "fanout",
    layout: "TB",
    promptTemplate: `[团队任务 · 分治聚合模式] 将大任务拆分为子任务，并行处理后汇总。

成员角色：
{{members_list}}

执行规则：
1. [拆分] 调用 delegate_task（goal 开头包含 [team:splitter-0]），
   让 {{member_0_name}}（{{member_0_role}}）将用户请求拆分为 {{member_count_minus_2}} 个子任务
   - 子任务应互不依赖、可独立完成
   - 输出格式：子任务 1: xxx / 子任务 2: xxx / ...
2. [并行处理] 对拆分出的每个子任务，调用对应的中间成员处理
   - 第 N 个子任务 → delegate_task（goal 开头包含 [team:worker-N]）给第 N+1 个成员
   - 每个成员的 context 包含对应的子任务描述
3. [汇总] 调用 delegate_task（goal 开头包含 [team:reducer-last]），
   让最后一个成员汇总所有子任务的结果
   - 去重、整合、补充逻辑连接
   - 输出完整的最终结果

用户请求：{{user_message}}`,
  },

  // ── 8. Custom 自定义 DAG ──
  {
    id: "custom",
    name: "自定义流程",
    icon: "🔧",
    description: "手动定义节点和依赖关系，完全自由编排",
    detail: "在编辑器中拖拽连线，定义每个节点的执行顺序和依赖。dagEdges 存储在团队配置中",
    isBuiltIn: true,
    minMembers: 1,
    topology: "dag",
    layout: "TB",
    promptTemplate: `[团队任务 · 自定义流程模式] 按照指定的节点依赖关系执行。

节点定义：
{{members_list}}

执行规则：
- 按照节点的依赖关系（DAG 拓扑序）依次执行
- 每个节点用 delegate_task 调用，goal 开头包含 [team:node-N] 标记
- 某节点的所有前驱节点完成后才能执行该节点
- 无依赖关系的节点可以并行
- 每个节点的 context 包含所有前驱节点的输出摘要
- 全部完成后，按拓扑序汇总各节点结果

用户请求：{{user_message}}`,
  },

  // ── 9. Loop 循环迭代 ──
  {
    id: "loop",
    name: "循环迭代",
    icon: "🔄",
    description: "执行 → 评估 → 不达标重试，死磕到底",
    detail: "第一个成员负责执行，第二个负责评估，不通过则带反馈重试。适合需要反复打磨的任务",
    isBuiltIn: true,
    minMembers: 2,
    maxMembers: 3,
    topology: "loop",
    layout: "LR",
    options: [
      { key: "maxRetries", label: "最大循环次数", type: "number", default: 3, min: 1, max: 10 },
    ],
    promptTemplate: `[团队任务 · 循环迭代模式] 执行 → 评估 → 不达标重试，直到通过或达到上限。

角色分配：
- [executor] {{member_0_icon}} {{member_0_name}}（{{member_0_role}}）— 负责执行任务
- [evaluator] {{member_1_icon}} {{member_1_name}}（{{member_1_role}}）— 负责评估质量

执行流程（最多循环 {{max_retries}} 次）：

第 1 轮：
1. 调用 delegate_task（goal 开头包含 [team:executor]），让 {{member_0_name}} 完成用户请求
2. 调用 delegate_task（goal 开头包含 [team:evaluator]），让 {{member_1_name}} 评估执行结果
   - 评估输出格式必须为：
     - PASS — 如果质量达标，附简要说明
     - FAIL — 如果不达标，列出具体问题
3. 如果 PASS → 输出最终结果，结束
4. 如果 FAIL → 进入第 2 轮

第 2+ 轮（修复迭代）：
1. 调用 delegate_task（goal 开头包含 [team:executor]），让 {{member_0_name}} 根据评估反馈修复
   - context 参数必须包含上一轮评估者的具体问题列表
2. 再次调用 {{member_1_name}} 评估（同第 1 轮步骤 2）
3. 如果 PASS → 输出最终结果，结束
4. 如果 FAIL 且未达上限 → 继续下一轮

如果达到 {{max_retries}} 次仍未通过：
- 输出当前最佳结果
- 列出仍未解决的问题
- 不要说"已完成"，要明确标注未完成的项

关键规则：
- 每轮 executor 的 context 必须包含评估者的反馈
- 评估者必须给出明确的 PASS/FAIL 判断，不能模棱两可
- executor 修复时必须针对评估者提出的问题逐条修复
{{member_2_nameexists_true}}
- {{member_2_name}}（{{member_2_role}}）作为最终审核者，在 executor 和 evaluator 都通过后做最终确认{{member_2_nameexists_false}}

用户请求：{{user_message}}`,
  },
];
