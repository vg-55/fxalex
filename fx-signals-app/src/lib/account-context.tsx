"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type AccountSettings = {
  equity: number;
  riskPerTradePct: number;
  maxConcurrent: number;
};

type Ctx = {
  settings: AccountSettings | null;
  refresh: () => Promise<void>;
  update: (s: AccountSettings) => void;
};

const AccountContext = createContext<Ctx>({
  settings: null,
  refresh: async () => undefined,
  update: () => undefined,
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AccountSettings | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/account", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as AccountSettings;
      setSettings({
        equity: data.equity,
        riskPerTradePct: data.riskPerTradePct,
        maxConcurrent: data.maxConcurrent,
      });
    } catch {}
  }, []);

  const update = useCallback((s: AccountSettings) => setSettings(s), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <AccountContext.Provider value={{ settings, refresh, update }}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  return useContext(AccountContext);
}
