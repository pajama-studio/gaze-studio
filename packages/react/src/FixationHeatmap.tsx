import { useEffect, useRef } from "react";
import type { Fixation } from "@pajama-studio/gaze-core";
export function FixationHeatmap({
  width,
  height,
  fixations,
  visible = true,
}: {
  width: number;
  height: number;
  fixations: Fixation[];
  visible?: boolean;
}) {
  const heat = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!visible || !heat.current) return;
    const canvas = heat.current,
      ctx = canvas.getContext("2d")!;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "screen";
    for (const f of fixations) {
      const radius = Math.max(24, width * 0.045),
        g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
      const weight = Math.min(0.6, (f.end - f.start) / 2e6);
      g.addColorStop(0, `rgba(255,55,55,${weight})`);
      g.addColorStop(0.45, `rgba(255,180,30,${weight * 0.6})`);
      g.addColorStop(1, "rgba(20,150,220,0)");
      ctx.fillStyle = g;
      ctx.fillRect(f.x - radius, f.y - radius, radius * 2, radius * 2);
    }
  }, [visible, fixations, width, height]);
  return (
    <canvas
      ref={heat}
      className="heat-layer"
      style={{ display: visible ? "block" : "none" }}
      aria-label="Fixation duration heatmap"
    />
  );
}
