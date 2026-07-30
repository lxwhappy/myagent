// 纯 CSS spinner — border 旋转，配合 design system 颜色
// 轨道 accent-tint + 头部 accent，与 .session-spinner 设计语言一致

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 14, className = "" }: SpinnerProps) {
  return (
    <span
      className={`spinner ${className}`}
      style={{
        width: size,
        height: size,
        borderWidth: size >= 24 ? 2 : 1.5,
      }}
    />
  );
}
