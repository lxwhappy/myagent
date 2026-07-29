// 纯 CSS spinner — 比 SVG 旋转更平滑，无光栅化抖动

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
        borderWidth: Math.max(2, Math.round(size / 6)),
      }}
    />
  );
}
