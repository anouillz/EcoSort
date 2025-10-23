import { useEffect, useRef, useState } from "react";

export function useLocalMedia() {
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
