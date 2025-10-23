
export const MATERIAL_COLORS: Record<string, string> = {
  glass: "#00a3a3",
  plastic: "#0078d4",
  metal: "#f59e0b",
  cardboard: "#16a34a",
  paper: "#8b5cf6",
  trash: "#ef4444",
};

export const CAPTURE = { MAX_LONG: 1024, QUALITY: 0.8 } as const;

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};