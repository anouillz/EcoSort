import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";

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

const MATERIAL_COLORS: Record<string, string> = {
  verre: "#00a3a3",
  plastique: "#0078d4",
  metal: "#f59e0b",
  papier_carton: "#16a34a",
  organique: "#8b5cf6",
  autre: "#ef4444",
};

const CAPTURE = { MAX_LONG: 1024, QUALITY: 0.8 };

function useApiBase() {
  const [apiBase, setApiBase] = useState<string>(
    () => (import.meta as any).env?.VITE_API_BASE || localStorage.getItem("API_BASE") || "http://localhost:8000"
  );
  useEffect(() => { localStorage.setItem("API_BASE", apiBase); }, [apiBase]);
  return { apiBase, setApiBase } as const;
}

function useMediaStream() {
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

function OverlayBoxes({
  items,
  imgRect,
  scale,
}: {
  items: ManyItem[];
  imgRect: { x: number; y: number; w: number; h: number } | null;
  scale: number;
}) {
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
      const sx1 = Math.round((x1 - 0) * scale);
      const sy1 = Math.round((y1 - 0) * scale);
      const sx2 = Math.round((x2 - 0) * scale);
      const sy2 = Math.round((y2 - 0) * scale);
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

export default function App() {
  const { apiBase, setApiBase } = useApiBase();
  const { videoRef, ready } = useMediaStream();
  const [tab, setTab] = useState<"single" | "many" | "live">("single");
  const [busy, setBusy] = useState(false);
  const [lastRtt, setLastRtt] = useState<number | null>(null);
  const inFlightRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [single, setSingle] = useState<PredictSingleResponse | null>(null);
  const [many, setMany] = useState<PredictManyResponse | null>(null);
  const { counts: sessionCounts, addCounts, reset: resetSession } = useSessionStats();

  const containerRef = useRef<HTMLDivElement>(null);
  const [imgRect, setImgRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const scale = useMemo(() => {
    if (!videoRef.current || !imgRect) return 1;
    const vw = videoRef.current.videoWidth || imgRect.w;
    return vw ? imgRect.w / vw : 1;
  }, [videoRef.current?.videoWidth, imgRect]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const obs = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setImgRect({ x: 0, y: 0, w: Math.round(rect.width), h: Math.round(rect.width * 9 / 16) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

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

  const takePhoto = useCallback(async () => {
    if (!videoRef.current) return;
    setBusy(true);
    try {
      const blob = await drawToBlob(videoRef.current, CAPTURE.MAX_LONG, CAPTURE.QUALITY);
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
  }, [tab, postImage, addCounts]);

  const [live, setLive] = useState(false);
  const liveLoop = useCallback(async () => {
    if (!live || !videoRef.current) return;
    if (inFlightRef.current) { rafRef.current = window.setTimeout(liveLoop, 0) as unknown as number; return; }
    inFlightRef.current = true;
    try {
      const blob = await drawToBlob(videoRef.current, CAPTURE.MAX_LONG, CAPTURE.QUALITY);
      const { json, latency } = await postImage("/predict/many", blob);
      setMany(json);
      if (json?.counts) addCounts(json.counts);

      rafRef.current = window.setTimeout(liveLoop, 0) as unknown as number;
    } catch (e) {
      console.error(e);
      rafRef.current = window.setTimeout(liveLoop, 150) as unknown as number;
    } finally {
      inFlightRef.current = false;
    }
  }, [live, addCounts, postImage]);

  const stopLive = useCallback(() => {
    setLive(false);
    if (rafRef.current) { window.clearTimeout(rafRef.current); rafRef.current = null; }
  }, []);

  useEffect(() => {
    if (!live && rafRef.current) {
      window.clearTimeout(rafRef.current);
      rafRef.current = null;
    }
  }, [live]);

  useEffect(() => {
    if (live) {
      rafRef.current = window.setTimeout(liveLoop, 0) as unknown as number;
      return () => { if (rafRef.current) window.clearTimeout(rafRef.current); };
    }
  }, [live, liveLoop]);

  useEffect(() => { if (tab !== "live") setLive(false); }, [tab]);

  const totalSession = useMemo(() => Object.values(sessionCounts).reduce((a, b) => a + b, 0), [sessionCounts]);
  const qrUrl = useMemo(() => window.location.href, []);

  return (
    <div className="app">
      <header>
        <div className="header-inner" style={{display:'flex',alignItems:'center',gap:12,maxWidth:'1100px',margin:'0 auto',padding:'8px 16px'}}>
          <div className="title">♻️ EcoSort</div>
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
            <span className="muted">API:</span>
            <input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://localhost:8000"
              style={{width:'260px'}}
            />
          </div>
        </div>
      </header>

      <main className="container" style={{maxWidth:'1100px',margin:'0 auto',padding:'16px'}}>
        <div>
          <div className="tabbar">
            {["single", "many", "live"].map((t) => (
              <button key={t} onClick={() => setTab(t as any)} className={tab === t ? "is-active" : undefined}>
                {t === "single" ? "Photo — Single" : t === "many" ? "Photo — Multi" : "Live"}
              </button>
            ))}
          </div>

          <div ref={containerRef} className="video-shell">
            <video ref={videoRef} playsInline muted style={{ width:'100%', height:'auto', display:'block', aspectRatio: '16 / 9' }} />
            {tab !== "single" && imgRect && (
              <div style={{ pointerEvents:'none', position:'absolute', inset:0 }}>
                <OverlayBoxes items={many?.items || []} imgRect={imgRect} scale={scale} />
              </div>
            )}
          </div>

          <div style={{marginTop:12, display:'flex', flexWrap:'wrap', alignItems:'center', gap:12}}>
            {tab === "live" ? (
              !live ? (
                <button onClick={() => setLive(true)} className="btn-primary" disabled={!ready}>
                  Start Live
                </button>
              ) : (
                <>
                  <button onClick={stopLive} className="btn-danger">Stop Live</button>
                  {lastRtt != null && <span className="muted">RTT {Math.round(lastRtt)} ms</span>}
                </>
              )
            ) : (
              <button onClick={takePhoto} className="btn-primary" disabled={!ready || busy}>
                {busy ? "Analyse…" : "Prendre une photo"}
              </button>
            )}
            <button onClick={resetSession}>Réinitialiser la session</button>
          </div>
        </div>

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
                  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {many.items.map((it, i) => (
                      <span key={i} className="badge" style={{ background: (MATERIAL_COLORS[it.material] || "#ddd") + "33" }}>
                        {it.material} · {Math.round(it.score * 100)}%
                      </span>
                    ))}
                  </div>
                  <div style={{marginTop:12}}>
                    <div className="font-medium mb-1">Comptage (image courante)</div>
                    <CountsTable counts={many.counts} />
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{marginTop:16}}>
            <div className="font-medium mb-1">Statistiques de session</div>
            {totalSession === 0 ? (
              <div className="muted">Aucune donnée de session pour le moment.</div>
            ) : (
              <CountsTable counts={sessionCounts} />
            )}
          </div>

          <div style={{marginTop:24}}>
            <div className="font-medium mb-2">QR Code (ouvrir sur le téléphone)</div>
            <div className="qr-box">
              <QRCode value={qrUrl} size={144} />
            </div>
            <div className="muted" style={{marginTop:6}}>Scannez pour ouvrir cette page et utiliser la caméra du téléphone.</div>
          </div>
        </div>
      </main>

      <footer style={{padding:'16px', textAlign:'center'}}>
      </footer>
    </div>
  );
}

function CountsTable({ counts }: { counts: Record<string, number> }) {
  const mats = Object.keys(counts).sort();
  if (mats.length === 0) return <div className="muted">—</div>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Matière</th>
          <th style={{textAlign:'right'}}>Nombre</th>
        </tr>
      </thead>
      <tbody>
        {mats.map((m) => (
          <tr key={m}>
            <td>
              <span style={{display:'inline-flex',alignItems:'center',gap:8}}>
                <span className="dot" style={{ background: MATERIAL_COLORS[m] || "#d1d5db" }} />
                {m}
              </span>
            </td>
            <td style={{textAlign:'right'}}>{counts[m]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}