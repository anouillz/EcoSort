import { useCallback, useState } from "react";

export function useSessionStats() {
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
