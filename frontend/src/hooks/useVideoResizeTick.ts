import { useEffect, useState } from "react";

export function useVideoResizeTick(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const bump = () => setTick(t => t + 1);
    v.addEventListener('loadedmetadata', bump);
    v.addEventListener('resize', bump as any);
    return () => {
      v.removeEventListener('loadedmetadata', bump);
      v.removeEventListener('resize', bump as any);
    };
  }, [videoRef]);
  return tick;
}
