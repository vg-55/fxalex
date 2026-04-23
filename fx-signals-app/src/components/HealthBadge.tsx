"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

type Health = {
  status: "healthy" | "degraded" | "down";
  scanner: {
    lastOkAt: string | null;
    secondsSinceLastOk: number | null;
    consecutiveFailures: number;
    activeProvider: string | null;
    backoffUntil: string | null;
  };
  db: { ok: boolean; latencyMs: number | null };
  notifications: { unreadCount: number };
  externalNotifier: { enabled: boolean };
};

const COLORS: Record<Health["status"], { dot: string; text: string; label: string; Icon: typeof Activity }> = {
  healthy:  { dot: "bg-emerald-500", text: "text-emerald-400", label: "Healthy",  Icon: CheckCircle2 },
  degraded: { dot: "bg-amber-400",   text: "text-amber-300",   label: "Degraded", Icon: Activity },
  down:     { dot: "bg-rose-500",    text: "text-rose-300",    label: "Down",     Icon: AlertTriangle },
};

export default function HealthBadge() {
  const [h, setH] = useState<Health | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchIt = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json()) as Health;
        if (!cancelled) setH(data);
      } catch {
        if (!cancelled) setH((prev) => prev);
      }
    };
    fetchIt();
    const id = setInterval(fetchIt, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!h) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-slate-500">
        <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
        <span>Checking…</span>
      </div>
    );
  }

  const c = COLORS[h.status];
  const Icon = c.Icon;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 transition-colors"
        title={`Scanner ${c.label}`}
      >
        <span className="relative inline-flex h-2.5 w-2.5">
          {h.status !== "down" && (
            <span className={`absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-60 animate-ping`} />
          )}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${c.dot}`} />
        </span>
        <Icon size={12} className={c.text} />
        <span className={`text-xs font-medium ${c.text}`}>{c.label}</span>
        {h.scanner.secondsSinceLastOk != null && h.status !== "healthy" && (
          <span className="text-[10px] text-slate-500 ml-auto font-mono">
            {h.scanner.secondsSinceLastOk}s
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-[#0f172a] border border-slate-700 rounded-lg shadow-2xl z-50 p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-500">Scanner</span>
            <span className={c.text}>{c.label}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Last scan</span>
            <span className="text-slate-300 font-mono">
              {h.scanner.secondsSinceLastOk != null ? `${h.scanner.secondsSinceLastOk}s ago` : "never"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Provider</span>
            <span className="text-slate-300 font-mono">{h.scanner.activeProvider ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Failures</span>
            <span className={h.scanner.consecutiveFailures > 0 ? "text-amber-300" : "text-slate-300"}>
              {h.scanner.consecutiveFailures}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">DB</span>
            <span className={h.db.ok ? "text-emerald-400 font-mono" : "text-rose-400"}>
              {h.db.ok ? `${h.db.latencyMs}ms` : "down"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Push alerts</span>
            <span className={h.externalNotifier.enabled ? "text-emerald-400" : "text-slate-500"}>
              {h.externalNotifier.enabled ? "on" : "off"}
            </span>
          </div>
          {h.scanner.backoffUntil && (
            <div className="text-rose-400 text-[10px] pt-1 border-t border-slate-800">
              Backoff until {new Date(h.scanner.backoffUntil).toLocaleTimeString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
