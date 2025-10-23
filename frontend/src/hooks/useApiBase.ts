import { useState } from "react";

export function useApiBase() {
  const [apiBase] = useState(() => `${window.location.origin}/api`);
  return { apiBase, setApiBase: () => {} } as const;
}
