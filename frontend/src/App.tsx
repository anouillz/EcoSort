import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";

import { CAPTURE, MATERIAL_COLORS, RTC_CONFIG } from "./constants";
import { mkId, wsUrlSameOrigin, countByMaterial } from "./utils/misc";
import { drawToBlob, formatPercent } from "./utils/video";
import { getTracker } from "./utils/dedupe";

import { useApiBase } from "./hooks/useApiBase";
import { useLocalMedia } from "./hooks/useLocalMedia";
import { useSessionStats } from "./hooks/useSessionStats";
import { useVideoResizeTick } from "./hooks/useVideoResizeTick";

import { OverlayBoxes } from "./components/OverlayBoxes";
import { PhonePublisher } from "./components/PhonePublisher";
import { CountsTable } from "./components/CountsTable";

import type { PredictSingleResponse, PredictManyResponse } from "./types";

export default function App() {
  const { apiBase } = useApiBase();

  const isPhone = typeof window !== 'undefined' && window.location.pathname.startsWith('/phone');
  if (isPhone) {
    return <PhonePublisher apiBase={apiBase} />;
  }

  const { videoRef: localVideoRef } = useLocalMedia();

  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [remoteReady, setRemoteReady] = useState(false);
  const [roomId, setRoomId] = useState<string>("");
  const offeredRef = useRef(false);

  const [tab, setTab] = useState<"single" | "many" | "live">("single");
  const [busy, setBusy] = useState(false);
  const [single, setSingle] = useState<PredictSingleResponse | null>(null);
  const [many, setMany] = useState<PredictManyResponse | null>(null);
  const { counts: sessionCounts, addCounts, reset: resetSession } = useSessionStats();

  const localTick  = useVideoResizeTick(localVideoRef);
  const remoteTick = useVideoResizeTick(remoteVideoRef);

  const [usePhone, setUsePhone] = useState(false);

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

  useEffect(() => { if (remoteReady) setUsePhone(true); }, [remoteReady]);
  useEffect(() => { if (!remoteReady) setUsePhone(false); }, [remoteReady]);

  const activeVideoEl = (usePhone && remoteReady && remoteVideoRef.current) ? remoteVideoRef.current : localVideoRef.current;

  const handleResetSession = useCallback(() => {
    resetSession();
    getTracker("pc").reset();
    if (roomId) getTracker(`phone:${roomId}`).reset();
  }, [resetSession, roomId]);

  const postImage = useCallback(async (endpoint: "/predict/single" | "/predict/many", blob: Blob) => {
    const fd = new FormData(); fd.append("file", blob, "frame.jpg");
    const res = await fetch(`${apiBase}${endpoint}`, { method: "POST", body: fd });
    const json = await res.json();
    return { json };
  }, [apiBase]);

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

  // Live loop (switches source mid-run if you toggle camera)
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  useEffect(() => { liveRef.current = live; }, [live]);

  const runIdRef = useRef(0);
  const sourceRef = useRef<HTMLVideoElement|null>(null);
  useEffect(() => { sourceRef.current = activeVideoEl || null; }, [activeVideoEl]);

  const rafRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  const startLive = useCallback(() => {
    if (!activeVideoEl) return;

    setLive(true);
    runIdRef.current += 1;
    const myRun = runIdRef.current;

    const loop = async () => {
      if (myRun !== runIdRef.current) return;
      const src = sourceRef.current;
      if (!liveRef.current || !src) return;

      if (inFlightRef.current) {
        rafRef.current = window.setTimeout(loop, 0) as unknown as number;
        return;
      }

      inFlightRef.current = true;
      try {
        const blob = await drawToBlob(src, CAPTURE.MAX_LONG, CAPTURE.QUALITY);
        const { json } = await postImage("/predict/many", blob);
        setMany(json);
        const tracker = getTracker(cameraId);
        const fresh = tracker.dedupe(json.items);
        if (fresh.length) addCounts(countByMaterial(fresh));
      } catch (e) {
        console.error(e);
      } finally {
        inFlightRef.current = false;
      }

      if (myRun === runIdRef.current) {
        rafRef.current = window.setTimeout(loop, 0) as unknown as number;
      }
    };

    rafRef.current = window.setTimeout(loop, 0) as unknown as number;
  }, [postImage, activeVideoEl, addCounts]);

  const stopLive = useCallback(() => {
    setLive(false);
    runIdRef.current += 1;
    if (rafRef.current) { window.clearTimeout(rafRef.current); rafRef.current = null; }
  }, []);

  useEffect(() => { if (tab !== "live") setLive(false); }, [tab]);

  // QR and signaling
  const qrUrl = useMemo(() => {
    const rid = roomId || mkId();
    if (!roomId) setRoomId(rid);
    const u = new URL(window.location.href);
    u.pathname = "/phone";
    u.search = `?room=${rid}`;
    return u.toString();
  }, [roomId]);

  const totalSession = useMemo(
    () => Object.values(sessionCounts).reduce((a, b) => a + b, 0),
    [sessionCounts]
  );

  const cameraId = useMemo(
    () => (usePhone && remoteReady ? `phone:${roomId || "unknown"}` : "pc"),
    [usePhone, remoteReady, roomId]
  );

  const startViewer = useCallback(async () => {
    const rid = roomId || mkId();
    if (!roomId) setRoomId(rid);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    (async () => {
      try { pc.addTransceiver("video", { direction: "recvonly" }); } catch {}
    })();

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
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
        if (pc.signalingState !== "stable" || offeredRef.current) return;
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
  }, [roomId]);

  return (
    <div className="app">
      <header>
        <div className="header-inner" style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: '1100px', margin: '0 auto', padding: '8px 16px' }}>
          <div className="title">♻️ EcoSort</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }} />
        </div>
      </header>

      <main className="container" style={{ maxWidth: '1100px', margin: '0 auto', padding: '16px' }}>
        {/* Left column: video + controls */}
        <div>
          {/* Tabs */}
          <div className="tabbar">
            {["single", "many", "live"].map((t) => (
              <button key={t} onClick={() => setTab(t as any)} className={tab === t ? "is-active" : undefined}>
                {t === "single" ? "Photo — Single" : t === "many" ? "Photo — Multi" : "Live"}
              </button>
            ))}
          </div>

          {/* Video area */}
          <div ref={containerRef} className="video-shell" style={{ position: 'relative' }}>
            {/* local */}
            <video
              ref={localVideoRef}
              playsInline
              muted
              style={{
                width: '100%', height: 'auto', display: 'block', aspectRatio: '16 / 9',
                visibility: (usePhone && remoteReady) ? 'hidden' : 'visible'
              }}
            />
            {/* remote */}
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
                <OverlayBoxes
                  items={many?.items || []}
                  containerRect={{ w: imgRect.w, h: imgRect.h }}
                  videoEl={(usePhone && remoteReady) ? remoteVideoRef.current : localVideoRef.current}
                  videoTick={(usePhone && remoteReady) ? remoteTick : localTick}
                />
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setUsePhone((v) => !v)} disabled={!remoteReady}>
              Switch camera
            </button>

            {tab === "live" ? (
              !live ? (
                <button onClick={startLive} className="btn-primary" disabled={!activeVideoEl}>
                  Start Live
                </button>
              ) : (
                <button
                  onClick={stopLive}
                  style={{ color: '#fff', background: '#dc2626', border: '1px solid transparent', padding: '10px 14px', borderRadius: 12, fontWeight: 700 }}
                >
                  Stop Live
                </button>
              )
            ) : (
              <button onClick={takePhoto} className="btn-primary" disabled={!activeVideoEl || busy}>
                {busy ? "Analyzing…" : "Take photo"}
              </button>
            )}
            <button onClick={handleResetSession}>Reset session</button>
          </div>

          {/* WebRTC block */}
          <div className="panel" style={{ marginTop: 16 }}>
            <h3>Phone camera (WebRTC)</h3>
            {!remoteReady ? (
              <>
                <div className="muted" style={{ marginBottom: 8 }}>1) Click “Start session” below. 2) Scan the QR with your phone.</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn-primary" onClick={startViewer}>Start session</button>
                  <span className="muted">Room: {roomId || '—'}</span>
                  <div className="qr-box"><QRCode value={qrUrl} size={128} /></div>
                </div>
              </>
            ) : (
              <div className="muted">Stream connected ✔ — Room {roomId}</div>
            )}
          </div>
        </div>

        {/* Right column: results & stats */}
        <div className="panel">
          <h3>Results</h3>
          {tab === "single" && (
            <div>
              {!single ? (
                <div className="muted">Take a photo to see the prediction.</div>
              ) : (
                <div>
                  <div><strong>Material:</strong> {single.label}</div>
                  <div><strong>Confidence:</strong> {formatPercent(single.proba)}</div>
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
                <div className="muted">Take a photo (or start live) to see stats.</div>
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
                    <div className="font-medium mb-1">Counts (current image)</div>
                    <CountsTable counts={many.counts} />
                  </div>
                </>
              )}
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div className="font-medium mb-1">Session statistics</div>
            {totalSession === 0 ? (
              <div className="muted">No session data yet.</div>
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
