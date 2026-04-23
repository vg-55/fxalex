"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type LiveStatus = "idle" | "loading" | "ok" | "error";

type LiveStatusCtx = {
  status: LiveStatus;
  lastUpdated: Date | null;
  error: string | null;
  setStatus: (s: LiveStatus, opts?: { lastUpdated?: Date; error?: string | null }) => void;
};

const Ctx = createContext<LiveStatusCtx | null>(null);

export function LiveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatusState] = useState<LiveStatus>("idle");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStatus = useCallback<LiveStatusCtx["setStatus"]>((s, opts) => {
    setStatusState(s);
    if (opts?.lastUpdated) setLastUpdated(opts.lastUpdated);
    if (opts && "error" in opts) setError(opts.error ?? null);
  }, []);

  return (
    <Ctx.Provider value={{ status, lastUpdated, error, setStatus }}>
      {children}
    </Ctx.Provider>
  );
}

export function useLiveStatus() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLiveStatus must be used within LiveStatusProvider");
  return ctx;
}
