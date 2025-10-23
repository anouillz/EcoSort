
import type { ManyItem, BBox } from "../types";

type RecentHit = { box: BBox; t: number };

export class DedupeTracker {
  private recentByClass = new Map<string, RecentHit[]>();
  private IOU_THRESH: number;
  private COOL_MS: number;
  private KEEP_PER_CLASS: number;
  constructor(
    IOU_THRESH = 0.5,
    COOL_MS = 700,
    KEEP_PER_CLASS = 20
  ) {
    this.IOU_THRESH = IOU_THRESH;
    this.COOL_MS = COOL_MS;
    this.KEEP_PER_CLASS = KEEP_PER_CLASS;
  }

  private iou(a: BBox, b: BBox): number {
    const ax1 = Math.min(a[0], a[2]), ay1 = Math.min(a[1], a[3]);
    const ax2 = Math.max(a[0], a[2]), ay2 = Math.max(a[1], a[3]);
    const bx1 = Math.min(b[0], b[2]), by1 = Math.min(b[1], b[3]);
    const bx2 = Math.max(b[0], b[2]), by2 = Math.max(b[1], b[3]);
    const interX1 = Math.max(ax1, bx1), interY1 = Math.max(ay1, by1);
    const interX2 = Math.min(ax2, bx2), interY2 = Math.min(ay2, by2);
    const interW = Math.max(0, interX2 - interX1);
    const interH = Math.max(0, interY2 - interY1);
    const inter = interW * interH;
    const areaA = (ax2 - ax1) * (ay2 - ay1);
    const areaB = (bx2 - bx1) * (by2 - by1);
    const uni = areaA + areaB - inter;
    return uni > 0 ? inter / uni : 0;
  }

  dedupe(items: ManyItem[], nowMs: number = Date.now()): ManyItem[] {
    const fresh: ManyItem[] = [];
    const cutoff = nowMs - this.COOL_MS;

    for (const [mat, arr] of this.recentByClass) {
      this.recentByClass.set(mat, arr.filter(h => h.t >= cutoff));
    }

    for (const det of items) {
      const arr = this.recentByClass.get(det.material) ?? [];
      let matched = false, bestIou = 0, bestIdx = -1;

      for (let i = 0; i < arr.length; i++) {
        const hit = arr[i];
        if (hit.t < cutoff) continue;
        const v = this.iou(det.box, hit.box);
        if (v > bestIou) { bestIou = v; bestIdx = i; }
      }

      if (bestIdx !== -1 && bestIou >= this.IOU_THRESH) {
        const hit = arr[bestIdx];
        const a = 0.4;
        hit.box = [
          hit.box[0]*(1-a)+det.box[0]*a,
          hit.box[1]*(1-a)+det.box[1]*a,
          hit.box[2]*(1-a)+det.box[2]*a,
          hit.box[3]*(1-a)+det.box[3]*a,
        ];
        hit.t = nowMs;
        matched = true;
      }

      if (!matched) {
        fresh.push(det);
        arr.push({ box: det.box, t: nowMs });
        if (arr.length > this.KEEP_PER_CLASS) arr.shift();
        this.recentByClass.set(det.material, arr);
      }
    }
    return fresh;
  }

  reset() { this.recentByClass.clear(); }
}

const registry = new Map<string, DedupeTracker>();

export function getTracker(cameraId: string, opts?: {
  IOU_THRESH?: number; COOL_MS?: number; KEEP_PER_CLASS?: number;
}) {
  if (!registry.has(cameraId)) {
    registry.set(cameraId, new DedupeTracker(
      opts?.IOU_THRESH ?? 0.5,
      opts?.COOL_MS ?? 700,
      opts?.KEEP_PER_CLASS ?? 20
    ));
  }
  return registry.get(cameraId)!;
}
