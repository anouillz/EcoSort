export function mkId(len = 6) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

export function wsUrlSameOrigin(room: string, role: "pc" | "phone") {
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${window.location.host}/ws/relay/${room}?role=${role}`;
}

export function countByMaterial(items: { material: string }[]) {
  const out: Record<string, number> = {};
  for (const it of items) out[it.material] = (out[it.material] || 0) + 1;
  return out;
}