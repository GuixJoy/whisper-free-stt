import { useEffect, useRef, useState } from "react";

interface DataPoint {
  label: string;
  value: number;
}

interface VoiceActivityGraphProps {
  data: DataPoint[];
  title?: string;
  subtitle?: string;
}

function smoothPath(points: DataPoint[], width: number, height: number, padding: number): string {
  if (points.length === 0) return "";
  const maxVal = Math.max(...points.map((p) => p.value), 1);
  const xStep = (width - padding * 2) / (points.length - 1);

  const coords = points.map((p, i) => ({
    x: padding + i * xStep,
    y: height - padding - (p.value / maxVal) * (height - padding * 2),
  }));

  let d = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const cpx1 = prev.x + (curr.x - prev.x) * 0.4;
    const cpx2 = prev.x + (curr.x - prev.x) * 0.6;
    d += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return d;
}

function areaPath(points: DataPoint[], width: number, height: number, padding: number): string {
  const line = smoothPath(points, width, height, padding);
  if (!line) return "";
  const xStep = (width - padding * 2) / (points.length - 1);
  const lastX = padding + (points.length - 1) * xStep;
  return `${line} L ${lastX} ${height - padding} L ${padding} ${height - padding} Z`;
}

export default function VoiceActivityGraph({ data, title, subtitle }: VoiceActivityGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const width = 800;
  const height = 280;
  const padding = 40;

  const lineD = smoothPath(data, width, height, padding);
  const areaD = areaPath(data, width, height, padding);

  const maxVal = Math.max(...data.map((p) => p.value), 1);
  const xStep = (width - padding * 2) / (data.length - 1);

  const tooltipX = hoveredIndex !== null ? padding + hoveredIndex * xStep : 0;
  const tooltipY = hoveredIndex !== null ? height - padding - (data[hoveredIndex].value / maxVal) * (height - padding * 2) : 0;

  return (
    <div className="flex flex-col">
      {(title || subtitle) && (
        <div className="mb-5">
          {title && <h3 className="text-[18px] font-semibold text-text-primary mb-1">{title}</h3>}
          {subtitle && <p className="text-[13px] text-text-muted">{subtitle}</p>}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        style={{ maxHeight: "280px" }}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((pct) => (
          <line
            key={pct}
            x1={padding}
            y1={height - padding - pct * (height - padding * 2)}
            x2={width - padding}
            y2={height - padding - pct * (height - padding * 2)}
            stroke="rgba(44,37,32,0.06)"
            strokeWidth={1}
          />
        ))}

        {/* Area fill */}
        <path
          d={areaD}
          fill="url(#areaGradient)"
          opacity={isVisible ? 1 : 0}
          style={{ transition: "opacity 1s ease-out" }}
        />

        {/* Primary line — Alpine */}
        <path
          d={lineD}
          fill="none"
          stroke="#3B6B9E"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={isVisible ? "0" : "2000"}
          strokeDashoffset={isVisible ? "0" : "2000"}
          style={{
            transition: "stroke-dashoffset 1200ms ease-out",
          }}
        />

        {/* Secondary line — Lavender (offset for depth) */}
        <path
          d={lineD}
          fill="none"
          stroke="#A88CC8"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.3}
          strokeDasharray={isVisible ? "0" : "2000"}
          strokeDashoffset={isVisible ? "0" : "2000"}
          style={{
            transition: "stroke-dashoffset 1200ms ease-out 200ms",
            transform: "translate(2px, -2px)",
          }}
        />

        {/* Data points */}
        {data.map((point, i) => {
          const cx = padding + i * xStep;
          const cy = height - padding - (point.value / maxVal) * (height - padding * 2);
          const isHovered = hoveredIndex === i;
          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r={isHovered ? 6 : 4}
                fill={isHovered ? "#FF3B56" : "#3B6B9E"}
                stroke="white"
                strokeWidth={2}
                opacity={isVisible ? 1 : 0}
                style={{
                  transition: "opacity 600ms ease-out, r 150ms ease, fill 150ms ease",
                  transitionDelay: `${800 + i * 60}ms`,
                  cursor: "pointer",
                }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            </g>
          );
        })}

        {/* Tooltip */}
        {hoveredIndex !== null && (
          <g>
            <line
              x1={tooltipX}
              y1={padding}
              x2={tooltipX}
              y2={height - padding}
              stroke="#3B6B9E"
              strokeWidth={1}
              strokeDasharray="4 4"
              opacity={0.4}
            />
            <rect
              x={tooltipX - 40}
              y={tooltipY - 36}
              width={80}
              height={28}
              rx={6}
              fill="#2C2520"
              opacity={0.92}
            />
            <text
              x={tooltipX}
              y={tooltipY - 18}
              textAnchor="middle"
              fill="white"
              fontSize={12}
              fontWeight={500}
            >
              {data[hoveredIndex].value.toLocaleString()} words
            </text>
          </g>
        )}

        {/* X-axis labels */}
        {data.map((point, i) => {
          const x = padding + i * xStep;
          return (
            <text
              key={i}
              x={x}
              y={height - padding + 20}
              textAnchor="middle"
              fill="#9C9590"
              fontSize={11}
            >
              {point.label}
            </text>
          );
        })}

        <defs>
          <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B6B9E" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#3B6B9E" stopOpacity={0.01} />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
