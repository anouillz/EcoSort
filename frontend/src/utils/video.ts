export async function drawToBlob(
  video: HTMLVideoElement,
  maxLongSide = 1024,
  quality = 0.75
): Promise<Blob> {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) throw new Error("Video not ready");
  const scale = maxLongSide / Math.max(vw, vh);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, cw, ch);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", quality)
  );
}

export function getRenderedVideoRect(
  video: HTMLVideoElement,
  containerW: number,
  containerH: number
) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.min(containerW / vw, containerH / vh);
  const w = vw * scale;
  const h = vh * scale;
  const x = (containerW - w) / 2;
  const y = (containerH - h) / 2;
  return { x, y, w, h, vw, vh };
}

export function boxesAreNormalized(items: { box: [number, number, number, number] }[]) {
  if (!items?.length) return true;
  const m = Math.max(...items.flatMap(it => it.box));
  return m <= 1.00001;
}

export function formatPercent(x: number) {
  return `${(x * 100).toFixed(1)}%`;
}
