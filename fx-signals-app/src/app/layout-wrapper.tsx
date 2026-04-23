"use client";

import { ReactNode, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LineChart, LayoutDashboard, Settings as Cog, Wallet, TrendingUp } from "lucide-react";
import { LiveStatusProvider, useLiveStatus } from "@/lib/live-status";
import { AccountProvider, useAccount } from "@/lib/account-context";
import HealthBadge from "@/components/HealthBadge";
import NotificationCenter, { type NotificationItem } from "@/components/NotificationCenter";
import SettingsDrawer from "@/components/SettingsDrawer";

function StatusDot() {
  const { status, error } = useLiveStatus();
  const map = {
    idle: { color: "bg-slate-500", pulse: false, label: "Idle" },
    loading: { color: "bg-amber-400", pulse: true, label: "Connecting" },
    ok: { color: "bg-emerald-500", pulse: true, label: "Live" },
    error: { color: "bg-rose-500", pulse: false, label: "Error" },
  }[status];
  return (
    <div className="flex items-center gap-2" title={error ?? map.label}>
      <span className="relative inline-flex h-2 w-2">
        {map.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${map.color} opacity-60 animate-ping`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${map.color}`} />
      </span>
      <span className="text-xs text-slate-500 font-medium">{map.label}</span>
    </div>
  );
}

function NavLink({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-sm font-medium ${
        active
          ? "bg-blue-500/10 text-blue-300 border border-blue-500/20"
          : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
      }`}
    >
      <span className={active ? "text-blue-400" : "text-slate-500"}>{icon}</span>
      {label}
    </Link>
  );
}

function MobileNavLink({ href, icon, label, active }: { href: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
        active ? "text-blue-400" : "text-slate-600 hover:text-slate-400"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function SettingsRefreshBridge() {
  const { refresh } = useAccount();
  useEffect(() => {
    const h = () => refresh();
    window.addEventListener("account:updated", h);
    return () => window.removeEventListener("account:updated", h);
  }, [refresh]);
  return null;
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { settings } = useAccount();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=50", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: NotificationItem[] };
      setNotifications(data.notifications);
    } catch {}
  }, []);

  useEffect(() => {
    loadNotifications();
    const es = new EventSource("/api/stream");
    es.addEventListener("notifications:snapshot", (ev) => {
      const { items } = JSON.parse((ev as MessageEvent).data) as { items: NotificationItem[] };
      setNotifications(items);
    });
    es.addEventListener("notifications:new", (ev) => {
      const { items } = JSON.parse((ev as MessageEvent).data) as { items: NotificationItem[] };
      setNotifications((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...items.filter((n) => !seen.has(n.id)), ...prev].slice(0, 100);
      });
    });
    return () => es.close();
  }, [loadNotifications]);

  return (
    <div className="flex min-h-screen bg-[#080e1a] text-slate-200">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 bg-[#0a1120] border-r border-white/[0.06] flex-col shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-white/[0.06]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
            <TrendingUp size={14} className="text-white" />
          </div>
          <div>
            <div className="text-[13px] font-black tracking-tight text-white leading-none">S&F SIGNALS</div>
            <div className="text-[9px] text-slate-500 tracking-widest uppercase mt-0.5">FX Alex G</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          <NavLink href="/" icon={<LayoutDashboard size={15} />} label="Live Signals" active={pathname === "/"} />
          <NavLink href="/performance" icon={<LineChart size={15} />} label="Performance" active={pathname === "/performance"} />
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-white/[0.06] space-y-2">
          {settings && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:border-white/10 hover:bg-white/[0.05] transition text-left"
            >
              <div className="w-6 h-6 rounded-md bg-emerald-500/15 flex items-center justify-center shrink-0">
                <Wallet size={12} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider">Account</div>
                <div className="text-xs font-bold text-slate-200 truncate">
                  ${settings.equity.toLocaleString()} · {settings.riskPerTradePct}%
                </div>
              </div>
              <Cog size={13} className="text-slate-600 shrink-0" />
            </button>
          )}
          <div className="flex items-center justify-between px-1">
            <StatusDot />
            <div className="flex items-center gap-1.5">
              <NotificationCenter items={notifications} onRefresh={loadNotifications} />
            </div>
          </div>
          <HealthBadge />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0a1120]/95 backdrop-blur-md border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Activity size={12} className="text-white" />
          </div>
          <span className="text-sm font-black text-white tracking-tight">S&F</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot />
          <NotificationCenter items={notifications} onRefresh={loadNotifications} />
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition"
          >
            <Cog size={15} />
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-auto pt-14 md:pt-0 pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0a1120]/95 backdrop-blur-md border-t border-white/[0.06] flex">
        <MobileNavLink href="/" icon={<LayoutDashboard size={17} />} label="Signals" active={pathname === "/"} />
        <MobileNavLink href="/performance" icon={<LineChart size={17} />} label="Perf" active={pathname === "/performance"} />
      </nav>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaved={() => window.dispatchEvent(new Event("account:updated"))}
      />
    </div>
  );
}

export default function LayoutWrapper({ children }: { children: ReactNode }) {
  return (
    <LiveStatusProvider>
      <AccountProvider>
        <SettingsRefreshBridge />
        <Shell>{children}</Shell>
      </AccountProvider>
    </LiveStatusProvider>
  );
}
