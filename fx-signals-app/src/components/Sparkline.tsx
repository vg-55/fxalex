"use client";

type Props = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
};

export default function Sparkline({
  data,
  width = 140,
  height = 36,
  color = "#60a5fa",
  fillOpacity = 0.18,
}: Props) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-slate-600"
        style={{ width, height }}
      >
        —
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = data[data.length - 1];
  const first = data[0];
  const up = last >= first;
  const strokeColor = up ? "#10b981" : "#ef4444";
  const areaColor = color === "#60a5fa" ? strokeColor : color;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={`0,${height} ${points} ${width},${height}`}
        fill={areaColor}
        fillOpacity={fillOpacity}
        stroke="none"
      />
      <polyline points={points} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
