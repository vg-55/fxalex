"use client";

import { AlertTriangle } from "lucide-react";

type Event = {
  title: string;
  country: string;
  scheduledAt: string;
  minutesUntil: number;
};

export default function NewsWarning({ event }: { event: Event }) {
  const when =
    event.minutesUntil > 0
      ? `in ${event.minutesUntil}m`
      : event.minutesUntil === 0
      ? "now"
      : `${Math.abs(event.minutesUntil)}m ago`;

  return (
    <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-2 text-sm">
      <AlertTriangle size={16} className="text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-amber-300 font-semibold">News guard active</span>
        <span className="text-slate-400 mx-2">·</span>
        <span className="text-slate-300 truncate">
          {event.country} {event.title}
        </span>
      </div>
      <span className="text-amber-300 font-mono text-xs shrink-0">{when}</span>
    </div>
  );
}
