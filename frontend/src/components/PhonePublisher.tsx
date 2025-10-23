import { useEffect, useRef, useState } from "react";
import { RTC_CONFIG } from "../constants";
import { wsUrlSameOrigin } from "../utils/misc";

export function PhonePublisher({ apiBase }: { apiBase: string }) {
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

        ws.onopen = () => setStatus("waiting-offer");

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
      <div className="muted" style={{ marginBottom: 8 }}>Status: {status}</div>
      <div className="video-shell" style={{ maxWidth: 480 }}>
        <video ref={videoSelfRef} playsInline muted style={{ width: '100%', height: 'auto', display: 'block', aspectRatio: '16 / 9' }} />
      </div>
      <div className="muted" style={{ marginTop: 8 }}>Keep this page open to publish the stream.</div>
    </div>
  );
}
