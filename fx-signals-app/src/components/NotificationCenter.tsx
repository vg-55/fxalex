"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Bell, X, CheckCheck, AlertTriangle, Sparkles, Eye, Info } from "lucide-react";

export type NotificationItem = {
  id: string;
  severity: "info" | "watch" | "actionable" | "critical";
  title: string;
  body: string;
  pair: string | null;
  readAt: string | null;
  createdAt: string;
};

const SEVERITY_STYLE: Record<NotificationItem["severity"], { color: string; bg: string; border: string; Icon: typeof Info }> = {
  info:       { color: "text-slate-300",   bg: "bg-slate-500/10",   border: "border-slate-500/30",   Icon: Info },
  watch:      { color: "text-amber-300",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   Icon: Eye },
  actionable: { color: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", Icon: Sparkles },
  critical:   { color: "text-rose-300",    bg: "bg-rose-500/10",    border: "border-rose-500/30",    Icon: AlertTriangle },
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type Props = {
  items: NotificationItem[];
  onRefresh: () => void;
};

export default function NotificationCenter({ items, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = items.filter((n) => !n.readAt).length;

  const markAllRead = useCallback(async () => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    onRefresh();
  }, [onRefresh]);

  const markOne = useCallback(async (id: string) => {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    onRefresh();
  }, [onRefresh]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800 text-slate-300 transition-colors"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[380px] max-h-[520px] overflow-hidden bg-[#0f172a] border border-slate-700 rounded-xl shadow-2xl z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-slate-400" />
              <h3 className="text-sm font-semibold text-white">Notifications</h3>
              <span className="text-xs text-slate-500">({unreadCount} unread)</span>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-800"
                  title="Mark all read"
                >
                  <CheckCheck size={14} /> All read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="overflow-auto flex-1">
            {items.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No notifications yet. The scanner will post here as setups develop.
              </div>
            ) : (
              <ul className="divide-y divide-slate-800">
                {items.map((n) => {
                  const style = SEVERITY_STYLE[n.severity] ?? SEVERITY_STYLE.info;
                  const Icon = style.Icon;
                  return (
                    <li
                      key={n.id}
                      className={`p-3 hover:bg-slate-800/40 cursor-pointer ${!n.readAt ? "bg-slate-800/20" : ""}`}
                      onClick={() => !n.readAt && markOne(n.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`shrink-0 mt-0.5 p-1.5 rounded-md ${style.bg} ${style.border} border`}>
                          <Icon size={14} className={style.color} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-medium leading-tight ${!n.readAt ? "text-white" : "text-slate-300"}`}>
                              {n.title}
                            </p>
                            {!n.readAt && (
                              <span className="shrink-0 w-2 h-2 rounded-full bg-blue-500 mt-1.5" />
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1 line-clamp-3 leading-relaxed">
                            {n.body}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-medium">
                            {n.pair && <span>{n.pair}</span>}
                            {n.pair && <span>•</span>}
                            <span className={style.color}>{n.severity}</span>
                            <span>•</span>
                            <span>{timeAgo(n.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
