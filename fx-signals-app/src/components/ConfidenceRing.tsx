"use client";

type Props = {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  label?: string;
};

export default function ConfidenceRing({ value, size = 56, stroke = 5, label }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (clamped / 100) * circ;

  const color =
    clamped >= 85
      ? "var(--c-buy)"
      : clamped >= 70
      ? "var(--c-active)"
      : clamped >= 55
      ? "var(--c-warn)"
      : "var(--c-watching)";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#243049" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 400ms ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold" style={{ color }}>
          {Math.round(clamped)}
        </span>
        {label && <span className="text-[8px] uppercase tracking-wider text-slate-500">{label}</span>}
      </div>
    </div>
  );
}
