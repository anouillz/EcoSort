import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";

// =========================
// Types pour l'API ML
// =========================

type TopItem = { label: string; proba: number };

type PredictSingleResponse = {
  label: string;
  proba: number;
  top3?: TopItem[];
  recyclable?: boolean;
  latency_ms?: number;
};

type ManyItem = {
  box: [number, number, number, number];
  material: string;
  score: number;
  recyclable?: boolean;
};

type PredictManyResponse = {
  items: ManyItem[];
  counts: Record<string, number>;
  latency_ms?: number;
};

// =========================
// Constantes UI & Capture
// =========================

const MATERIAL_COLORS: Record<string, string> = {
  verre: "#00a3a3",
  plastique: "#0078d4",
  metal: "#f59e0b",
  papier_carton: "#16a34a",
  organique: "#8b5cf6",
  autre: "#ef4444",
};

// Réglage unique pour photo & live
const CAPTURE = { MAX_LONG: 1024, QUALITY: 0.8 } as const;

// =========================
// WebRTC helpers (signalisation via FastAPI WS)
// =========================

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function mkId(len = 6) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: len }, () => a[Math.floor(Math.random() * a.length)]).join("");
}

function wsUrl(baseApi: string, room: string, role: "pc" | "phone") {
  // baseApi ex: http://localhost:8000 -> ws://localhost:8000/ws/relay/<room>?role=pc|phone
  const u = new URL(baseApi);
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}/ws/relay/${room}?role=${role}`;
}

function wsUrlSameOrigin(room: string, role: "pc" | "phone") {
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${window.location.host}/ws/relay/${room}?role=${role}`;
}


// =========================
// Hooks utilitaires
// =========================

function useApiBase() {
  const [apiBase] = useState(() => `${window.location.origin}/api`);
  return { apiBase, setApiBase: () => {} } as const;
}

function useLocalMedia() {
  // flux caméra locale (pour mode PC sans téléphone)
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) return;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err) {
        console.error("getUserMedia error", err);
        setReady(false);
      }
    })();
    return () => {
      active = false;
      const s = videoRef.current?.srcObject as MediaStream | undefined;
      s?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  return { videoRef, ready } as const;
}

async function drawToBlob(video: HTMLVideoElement, maxLongSide = 1024, quality = 0.75): Promise<Blob> {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) throw new Error("Video not ready");
  const scale = maxLongSide / Math.max(vw, vh);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, cw, ch);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", quality));
}

function formatPercent(x: number) { return `${(x * 100).toFixed(1)}%`; }

function useSessionStats() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [frames, setFrames] = useState(0);
  const addCounts = useCallback((add: Record<string, number>) => {
    setCounts((prev) => {
      const next = { ...prev } as Record<string, number>;
      for (const k of Object.keys(add)) next[k] = (next[k] || 0) + (add[k] || 0);
      return next;
    });
    setFrames((f) => f + 1);
  }, []);
  const reset = useCallback(() => { setCounts({}); setFrames(0); }, []);
  return { counts, frames, addCounts, reset } as const;
}

// =========================
// Overlay des boîtes
// =========================

function OverlayBoxes({ items, imgRect, scale }: { items: ManyItem[]; imgRect: { x: number; y: number; w: number; h: number } | null; scale: number; }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRect) return;
    canvas.width = imgRect.w;
    canvas.height = imgRect.h;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const it of items) {
      const [x1, y1, x2, y2] = it.box;
      const color = MATERIAL_COLORS[it.material] || "#111827";
      const sx1 = Math.round(x1 * scale);
      const sy1 = Math.round(y1 * scale);
      const sx2 = Math.round(x2 * scale);
      const sy2 = Math.round(y2 * scale);
      const w = sx2 - sx1, h = sy2 - sy1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.strokeRect(sx1, sy1, w, h);
      const label = `${it.material} ${Math.round(it.score * 100)}%`;
      ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto";
      const pad = 4; const tw = Math.ceil(ctx.measureText(label).width) + pad * 2; const th = 18 + pad * 2;
      ctx.fillStyle = color + "33";
      ctx.fillRect(sx1, Math.max(0, sy1 - th), tw, th);
      ctx.fillStyle = "#111";
      ctx.fillText(label, sx1 + pad, Math.max(12 + pad, sy1 - th + 12 + pad - 2));
    }
  }, [items, imgRect, scale]);
  return <canvas ref={canvasRef} style={{ position: "absolute", inset: 0 }} />;
}

// =========================
// Page PHONE (publisher) – /phone?room=ABC123
// =========================

function PhonePublisher({ apiBase }: { apiBase: string }) {
  const videoSelfRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startedRef = useRef(false);              
  const [status, setStatus] = useState("ready");

  useEffect(() => {
    if (startedRef.current) return;             
    startedRef.current = true;

    const url = new URL(window.location.href);
    const room = url.searchParams.get("room") || "";
    if (!room) { setStatus("missing-room"); return; }

    const start = async () => {
      try {
        setStatus("init");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (videoSelfRef.current) {
          videoSelfRef.current.srcObject = stream;
          await videoSelfRef.current.play().catch(() => {});
        }

        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        pc.onicecandidate = (ev) => {
          if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "candidate", candidate: ev.candidate }));
          }
        };

        const ws = new WebSocket(wsUrlSameOrigin(room, "phone"));
        wsRef.current = ws;

        ws.onopen = () => setStatus("waiting-offer");   // 👈 visible pendant qu’on attend l’offer

        ws.onmessage = async (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === "offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ type: "answer", sdp: answer }));
            setStatus("streaming");
          } else if (msg.type === "candidate" && msg.candidate) {
            try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}
          }
        };

        ws.onclose = () => setStatus("closed");
        ws.onerror = () => setStatus("error");
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    };

    start();
    return () => {
      try { wsRef.current?.close(); } catch {}
      try { pcRef.current?.close(); } catch {}
      const s = videoSelfRef.current?.srcObject as MediaStream | null;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [apiBase]);

  return (
    <div className="app" style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <h3>📱 Phone Publisher</h3>
      <div className="muted" style={{ marginBottom: 8 }}>Statut: {status}</div>
      <div className="video-shell" style={{ maxWidth: 480 }}>
        <video ref={videoSelfRef} playsInline muted style={{ width: '100%', height: 'auto', display: 'block', aspectRatio: '16 / 9' }} />
      </div>
      <div className="muted" style={{ marginTop: 8 }}>Laisse cette page ouverte pour publier le flux.</div>
    </div>
  );
}

// =========================
// APP principale (PC viewer + ML)
// =========================

export default function App() {
  const { apiBase, setApiBase } = useApiBase();

  // Détection de la page phone
  const isPhone = typeof window !== 'undefined' && window.location.pathname.startsWith('/phone');
  if (isPhone) {
    return <PhonePublisher apiBase={apiBase} />;
  }

  // Caméra locale (fallback si pas de téléphone)
  const { videoRef: localVideoRef, ready: localReady } = useLocalMedia();

  // WebRTC côté PC (viewer)
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  const [roomId, setRoomId] = useState<string>("");
  const offeredRef = useRef(false); 

  // UI/ML states
  const [tab, setTab] = useState<"single" | "many" | "live">("single");
  const [busy, setBusy] = useState(false);
  const [lastRtt, setLastRtt] = useState<number | null>(null);
  const inFlightRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [single, setSingle] = useState<PredictSingleResponse | null>(null);
  const [many, setMany] = useState<PredictManyResponse | null>(null);
  const { counts: sessionCounts, addCounts, reset: resetSession } = useSessionStats();

  const [usePhone, setUsePhone] = useState(false);

  // Layout & overlay
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgRect, setImgRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setImgRect({ x: 0, y: 0, w: Math.round(rect.width), h: Math.round(rect.width * 9 / 16) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (remoteReady) setUsePhone(true);
  }, [remoteReady]);

  useEffect(() => {
    if (!remoteReady) setUsePhone(false);
  }, [remoteReady]);

  // Vidéo active = priorité au flux remote si prêt, sinon local
  const activeVideoEl = (remoteReady && remoteVideoRef.current) ? remoteVideoRef.current : localVideoRef.current;
  const scale = imgRect && activeVideoEl?.videoWidth ? (imgRect.w / activeVideoEl.videoWidth) : 1;

  // API ML
  const postImage = useCallback(async (endpoint: "/predict/single" | "/predict/many", blob: Blob) => {
    const fd = new FormData(); fd.append("file", blob, "frame.jpg");
    const t0 = performance.now();
    const res = await fetch(`${apiBase}${endpoint}`, { method: "POST", body: fd });
    const json = await res.json();
    const rtt = performance.now() - t0;
    setLastRtt(rtt);
    const latency = json.latency_ms ?? rtt;
    return { json, rtt, latency };
  }, [apiBase]);

  // Capture unique (photo)
  const takePhoto = useCallback(async () => {
    if (!activeVideoEl) return;
    setBusy(true);
    try {
      const blob = await drawToBlob(activeVideoEl, CAPTURE.MAX_LONG, CAPTURE.QUALITY);
      if (tab === "single") {
        const { json } = await postImage("/predict/single", blob);
        setSingle(json);
        if (json?.label) addCounts({ [json.label]: 1 });
      } else {
        const { json } = await postImage("/predict/many", blob);
        setMany(json);
        if (json?.counts) addCounts(json.counts);
      }
    } catch (e) { console.error(e); }
    finally { setBusy(false); }
  }, [tab, postImage, addCounts, activeVideoEl]);

  // Live piloté par la réponse
  const [live, setLive] = useState(false);
  const liveLoop = useCallback(async () => {
    if (!live || !activeVideoEl) return;
    if (inFlightRef.current) { rafRef.current = window.setTimeout(liveLoop, 0) as unknown as number; return; }
    inFlightRef.current = true;
    try {
      const blob = await drawToBlob(activeVideoEl, CAPTURE.MAX_LONG, CAPTURE.QUALITY);
      const { json } = await postImage("/predict/many", blob);
      setMany(json);
      if (json?.counts) addCounts(json.counts);
      rafRef.current = window.setTimeout(liveLoop, 0) as unknown as number;
    } catch (e) {
      console.error(e);
      rafRef.current = window.setTimeout(liveLoop, 150) as unknown as number;
    } finally {
      inFlightRef.current = false;
    }
  }, [live, postImage, addCounts, activeVideoEl]);

  const stopLive = useCallback(() => {
    setLive(false);
    if (rafRef.current) { window.clearTimeout(rafRef.current); rafRef.current = null; }
  }, []);

  useEffect(() => {
    if (!live && rafRef.current) { window.clearTimeout(rafRef.current); rafRef.current = null; }
  }, [live]);

  useEffect(() => {
    if (live) {
      rafRef.current = window.setTimeout(liveLoop, 0) as unknown as number;
      return () => { if (rafRef.current) window.clearTimeout(rafRef.current); };
    }
  }, [live, liveLoop]);

  useEffect(() => { if (tab !== "live") setLive(false); }, [tab]);

  // QR vers la page /phone?room=RID (même host que le front)
  const qrUrl = useMemo(() => {
    const rid = roomId || mkId();
    if (!roomId) setRoomId(rid);
    const u = new URL(window.location.href);
    u.pathname = "/phone";
    u.search = `?room=${rid}`;
    return u.toString();
  }, [roomId]);

  const totalSession = useMemo(() => Object.values(sessionCounts).reduce((a, b) => a + b, 0), [sessionCounts]);

  // --- Démarrage WebRTC côté PC (viewer) ---
  const startViewer = useCallback(async () => {
    const rid = roomId || mkId();
    if (!roomId) setRoomId(rid);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    offeredRef.current = false;
    try { pc.addTransceiver("video", { direction: "recvonly" }); } catch {}

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      console.log("ontrack: got remote stream", stream?.id, stream?.getTracks().map(t => t.kind));
      const remoteEl = remoteVideoRef.current;
      if (remoteEl) {
        remoteEl.srcObject = stream;
        remoteEl.play().catch((e) => console.warn("remote play() failed", e));
      }
      setRemoteReady(true);
    };


    pc.onicecandidate = (ev) => {
      if (ev.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "candidate", candidate: ev.candidate }));
      }
    };

    const ws = new WebSocket(wsUrlSameOrigin(rid, "pc"));
    wsRef.current = ws;

    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data);

      if (msg.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));

      } else if (msg.type === "candidate" && msg.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch {}

      } else if (msg.type === "peer-joined") {
        if (pc.signalingState !== "stable" || offeredRef.current) {
          console.log("skip offer; state=", pc.signalingState, "offered=", offeredRef.current);
          return;
        }
        const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", sdp: offer }));
        offeredRef.current = true;
      } else if (msg.type === "peer-left") {
        setRemoteReady(false);
        offeredRef.current = false;
      }
    };

    ws.onclose = () => { setRemoteReady(false); };
    ws.onerror = (e) => console.warn("ws error", e);
  }, [roomId, apiBase, localVideoRef]);


  return (
    <div className="app">
      <header>
        <div className="header-inner" style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: '1100px', margin: '0 auto', padding: '8px 16px' }}>
          <div className="title">♻️ EcoSort</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* <span className="muted">API:</span> */}
            {/* <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://localhost:8000" style={{ width: '260px' }} /> */}
          </div>
        </div>
      </header>

      <main className="container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '16px' }}>
        {/* Colonne gauche : vidéo + contrôles */}
        <div>
          {/* Tabs */}
          <div className="tabbar">
            {["single", "many", "live"].map((t) => (
              <button key={t} onClick={() => setTab(t as any)} className={tab === t ? "is-active" : undefined}>
                {t === "single" ? "Photo — Single" : t === "many" ? "Photo — Multi" : "Live"}
              </button>
            ))}
          </div>

          {/* Vidéo (remote si prêt, sinon locale) */}
          <div ref={containerRef} className="video-shell" style={{ position: 'relative' }}>
            {/* locale: toujours montée */}
            <video
              ref={localVideoRef}
              playsInline
              muted
              style={{
                width: '100%', height: 'auto', display: 'block', aspectRatio: '16 / 9',
                visibility: (usePhone && remoteReady) ? 'hidden' : 'visible'
              }}
            />
            {/* remote: toujours montée, superposée */}
            <video
              ref={remoteVideoRef}
              playsInline
              muted
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'contain',
                visibility: (usePhone && remoteReady) ? 'visible' : 'hidden'
              }}
            />

            {tab !== "single" && imgRect && (
              <div style={{ pointerEvents: 'none', position: 'absolute', inset: 0 }}>
                <OverlayBoxes items={many?.items || []} imgRect={imgRect} scale={scale} />
              </div>
            )}
          </div>


          {/* Contrôles capture */}
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setUsePhone((v) => !v)}
              disabled={!remoteReady}
            >
              Changer de caméra
            </button>

            {tab === "live" ? (
              !live ? (
                <button onClick={() => setLive(true)} className="btn-primary" disabled={!activeVideoEl}>
                  Start Live
                </button>
              ) : (
                <>
                  <button onClick={stopLive} style={{ color: '#fff', background: '#dc2626', border: '1px solid transparent', padding: '10px 14px', borderRadius: 12, fontWeight: 700 }}>Stop Live</button>
                  {lastRtt != null && <span className="muted">RTT {Math.round(lastRtt)} ms</span>}
                </>
              )
            ) : (
              <button onClick={takePhoto} className="btn-primary" disabled={!activeVideoEl || busy}>
                {busy ? "Analyse…" : "Prendre une photo"}
              </button>
            )}
            <button onClick={resetSession}>Réinitialiser la session</button>
          </div>

          {/* Bloc WebRTC: démarrage + QR */}
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Caméra téléphone (WebRTC)</h3>
            {!remoteReady ? (
              <>
                <div className="muted" style={{ marginBottom: 8 }}>1) Clique sur "Démarrer la session" ci‑dessous. 2) Scanne le QR avec le téléphone.</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn-primary" onClick={startViewer}>Démarrer la session</button>
                  <span className="muted">Room: {roomId || '—'}</span>
                  <div className="qr-box"><QRCode value={qrUrl} size={128} /></div>
                </div>
              </>
            ) : (
              <div className="muted">Flux connecté ✔ — Room {roomId}</div>
            )}
          </div>
        </div>

        {/* Colonne droite : résultats & stats */}
        <div className="panel">
          <h3>Résultats</h3>
          {tab === "single" && (
            <div>
              {!single ? (
                <div className="muted">Prenez une photo pour voir la prédiction.</div>
              ) : (
                <div>
                  <div><strong>Matière:</strong> {single.label}</div>
                  <div><strong>Confiance:</strong> {formatPercent(single.proba)}</div>
                  {single.top3 && (
                    <div className="muted">Top-3: {single.top3.map((t) => `${t.label} ${formatPercent(t.proba)}`).join(", ")}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab !== "single" && (
            <div>
              {!many ? (
                <div className="muted">Prenez une photo (ou démarrez le live) pour voir les statistiques</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {many.items.map((it, i) => (
                      <span key={i} className="badge" style={{ background: (MATERIAL_COLORS[it.material] || "#ddd") + "33" }}>
                        {it.material} · {Math.round(it.score * 100)}%
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <div className="font-medium mb-1">Comptage (image courante)</div>
                    <CountsTable counts={many.counts} />
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div className="font-medium mb-1">Statistiques de session</div>
            {totalSession === 0 ? (
              <div className="muted">Aucune donnée de session pour le moment.</div>
            ) : (
              <CountsTable counts={sessionCounts} />
            )}
          </div>
        </div>
      </main>

      <footer style={{ padding: '16px', textAlign: 'center' }}>
        <span className="muted">© {new Date().getFullYear()} EcoSort</span>
      </footer>
    </div>
  );
}

// =========================
// Tableau des comptes (droite)
// =========================

function CountsTable({ counts }: { counts: Record<string, number> }) {
  const mats = Object.keys(counts).sort();
  if (mats.length === 0) return <div className="muted">—</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Matière</th>
          <th style={{ textAlign: 'right' }}>Nombre</th>
        </tr>
      </thead>
      <tbody>
        {mats.map((m) => (
          <tr key={m}>
            <td>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="dot" style={{ background: MATERIAL_COLORS[m] || "#d1d5db" }} />
                {m}
              </span>
            </td>
            <td style={{ textAlign: 'right' }}>{counts[m]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
