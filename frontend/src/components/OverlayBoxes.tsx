import { useEffect, useRef } from "react";
import { MATERIAL_COLORS } from "../constants";
import type { ManyItem } from "../types";
import { boxesAreNormalized, getRenderedVideoRect } from "../utils/video";

export function OverlayBoxes({
  items,
  containerRect,
  videoEl,
  videoTick,
}: {
  items: ManyItem[];
  containerRect: { w: number; h: number } | null;
  videoEl: HTMLVideoElement | null;
  videoTick: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !containerRect || !videoEl) return;

    const cw = containerRect.w, ch = containerRect.h;
    canvas.width = cw; canvas.height = ch;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);

    const r = getRenderedVideoRect(videoEl, cw, ch);
    const isNorm = boxesAreNormalized(items);

    for (const it of items) {
      const [x1, y1, x2, y2] = it.box;

      const px1 = isNorm ? r.x + x1 * r.w : r.x + (x1 / r.vw) * r.w;
      const py1 = isNorm ? r.y + y1 * r.h : r.y + (y1 / r.vh) * r.h;
      const px2 = isNorm ? r.x + x2 * r.w : r.x + (x2 / r.vw) * r.w;
      const py2 = isNorm ? r.y + y2 * r.h : r.y + (y2 / r.vh) * r.h;

      const w = px2 - px1, h = py2 - py1;
      const color = MATERIAL_COLORS[it.material] || "#111827";

      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.strokeRect(px1, py1, w, h);

      const label = `${it.material} ${Math.round(it.score * 100)}%`;
      ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto";
      const pad = 4;
      const tw = Math.ceil(ctx.measureText(label).width) + pad * 2;
      const th = 18 + pad * 2;
      ctx.fillStyle = color + "33";
      ctx.fillRect(px1, Math.max(0, py1 - th), tw, th);
      ctx.fillStyle = "#111";
      ctx.fillText(label, px1 + pad, Math.max(12 + pad, py1 - th + 12 + pad - 2));
    }
  }, [items, containerRect, videoEl, videoTick]);

  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />;
}
