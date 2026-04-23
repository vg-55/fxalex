"use client";

import { ReactNode, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, LineChart, LayoutDashboard, Settings as Cog, Wallet } from "lucide-react";
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
    error: { color: "bg-rose-500", pulse: false, label: "Disconnected" },
  }[status];
  return (
    <div className="flex items-center gap-2 px-2 py-1.5" title={error ?? map.label}>
      <span className="relative inline-flex h-2.5 w-2.5">
        {map.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${map.color} opacity-60 animate-ping`} />
        )}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${map.color}`} />
      </span>
      <span className="text-xs text-slate-400 font-medium">{map.label}</span>
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm ${
        active
          ? "bg-blue-500/15 text-blue-300 border border-blue-500/30"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent"
      }`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </Link>
  );
}

function MobileNavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex-1 flex flex-col items-center justify-center py-2.5 text-[10px] font-semibold ${
        active ? "text-blue-300" : "text-slate-500"
      }`}
    >
      {icon}
      <span className="mt-0.5">{label}</span>
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
        const merged = [...items.filter((n) => !seen.has(n.id)), ...prev];
        return merged.slice(0, 100);
      });
    });
    return () => es.close();
  }, [loadNotifications]);

  return (
    <div className="flex min-h-screen bg-[#0a1020] text-slate-200">
      <aside className="hidden md:flex w-[260px] bg-[#0d1426] border-r border-[#243049] p-4 flex-col">
        <div className="flex items-center gap-2.5 mb-8 px-2">
          <div className="p-1.5 rounded-lg bg-blue-500/15 text-blue-400">
            <Activity size={18} />
          </div>
          <h1 className="text-[15px] font-black tracking-tight text-white">S&amp;F SIGNALS</h1>
        </div>

        <nav className="flex-1 space-y-1">
          <NavLink href="/" icon={<LayoutDashboard size={16} />} label="Live Signals" active={pathname === "/"} />
          <NavLink
            href="/performance"
            icon={<LineChart size={16} />}
            label="Performance"
            active={pathname === "/performance"}
          />
          <NavLink
            href="/strategy"
            icon={<BookOpen size={16} />}
            label="The Strategy"
            active={pathname === "/strategy"}
          />
        </nav>

        <div className="mt-auto pt-4 border-t border-[#243049] space-y-3">
          {settings && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-[#111a2e] border border-[#243049] hover:border-[#2f3d5b] transition text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Wallet size={14} className="text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Equity</div>
                  <div className="text-sm font-bold text-white truncate">
                    {"$"}{settings.equity.toLocaleString()} &middot; {settings.riskPerTradePct}%
                  </div>
                </div>
              </div>
              <Cog size={14} className="text-slate-500 shrink-0" />
            </button>
          )}

          <div className="flex items-center justify-between gap-2">
            <StatusDot />
            <NotificationCenter items={notifications} onRefresh={loadNotifications} />
          </div>
          <HealthBadge />
          <div className="text-[10px] text-slate-600 px-2 leading-relaxed">
            Built on FX Alex G Set &amp; Forget
          </div>
        </div>
      </aside>

      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0d1426]/95 backdrop-blur border-b border-[#243049] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className="text-blue-400" />
          <span className="text-sm font-black text-white">S&amp;F</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusDot />
          <NotificationCenter items={notifications} onRefresh={loadNotifications} />
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5"
          >
            <Cog size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 min-w-0 overflow-auto pt-14 md:pt-0 pb-16 md:pb-0">{children}</main>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0d1426]/95 backdrop-blur border-t border-[#243049] flex">
        <MobileNavLink href="/" icon={<LayoutDashboard size={18} />} label="Live" active={pathname === "/"} />
        <MobileNavLink href="/performance" icon={<LineChart size={18} />} label="Perf" active={pathname === "/performance"} />
        <MobileNavLink href="/strategy" icon={<BookOpen size={18} />} label="Docs" active={pathname === "/strategy"} />
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
