"use client";

import { useEffect, useState } from "react";
import { X, Settings as Cog } from "lucide-react";

export type AccountSettings = {
  equity: number;
  riskPerTradePct: number;
  maxConcurrent: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  settings: AccountSettings | null;
  onSaved: (s: AccountSettings) => void;
};

export default function SettingsDrawer({ open, onClose, settings, onSaved }: Props) {
  const [equity, setEquity] = useState("10000");
  const [risk, setRisk] = useState("1");
  const [maxC, setMaxC] = useState("3");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEquity(String(settings.equity));
    setRisk(String(settings.riskPerTradePct));
    setMaxC(String(settings.maxConcurrent));
  }, [settings, open]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body = {
        equity: parseFloat(equity),
        riskPerTradePct: parseFloat(risk),
        maxConcurrent: parseInt(maxC, 10),
      };
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "save failed");
      const data = (await res.json()) as AccountSettings;
      onSaved(data);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[#111a2e] border-l border-[#243049] h-full shadow-2xl flex flex-col anim-fade-in-up">
        <header className="flex items-center justify-between p-5 border-b border-[#243049]">
          <div className="flex items-center gap-2">
            <Cog size={18} className="text-blue-400" />
            <h2 className="text-lg font-bold text-white">Account &amp; Risk</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/5 text-slate-400 hover:text-white transition"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-auto p-5 space-y-5">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
              Equity (USD)
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={equity}
              onChange={(e) => setEquity(e.target.value)}
              className="w-full bg-[#0a1020] border border-[#243049] rounded-lg px-3 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
              Risk per trade (%)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={risk}
              onChange={(e) => setRisk(e.target.value)}
              className="w-full bg-[#0a1020] border border-[#243049] rounded-lg px-3 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Typical range 0.5–2%. Strategy recommends 1%.
            </p>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
              Max concurrent trades
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={maxC}
              onChange={(e) => setMaxC(e.target.value)}
              className="w-full bg-[#0a1020] border border-[#243049] rounded-lg px-3 py-2.5 text-white font-mono focus:outline-none focus:border-blue-500"
            />
          </div>

          {err && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-md p-2">
              {err}
            </div>
          )}
        </div>

        <footer className="p-5 border-t border-[#243049] flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg bg-[#1f2d4a] text-slate-300 hover:bg-[#243049] transition text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
