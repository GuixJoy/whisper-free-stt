import { useEffect, useRef } from "react";
import { micLevelEmitter } from "@/utils/mic-emitter";

interface Props {
  width?: number;
  height?: number;
  barCount?: number;
  color?: string;
}

export default function Waveform({
  width = 200,
  height = 40,
  barCount = 32,
  color = "#3B6B9E",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>(new Array(barCount).fill(0));
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const unsubscribe = micLevelEmitter.subscribe((level: number) => {
      // Update bars with smoothing
      const bars = barsRef.current;
      for (let i = 0; i < bars.length; i++) {
        const target = level * (0.5 + 0.5 * Math.sin(Date.now() / 200 + i * 0.3));
        bars[i] += (target - bars[i]) * 0.3;
      }
    });

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const bars = barsRef.current;
      const barWidth = width / bars.length - 2;

      for (let i = 0; i < bars.length; i++) {
        const barHeight = Math.max(2, bars[i] * height);
        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;

        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3 + bars[i] * 0.7;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      unsubscribe();
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [width, height, barCount, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height }}
      className="rounded"
    />
  );
}
