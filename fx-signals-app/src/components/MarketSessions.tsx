"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { clsx } from "clsx";

export default function MarketSessions() {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return <div className="h-[48px] bg-[#0a1120] border-b border-white/[0.06]" />;

  const utcHour = time.getUTCHours();
  
  // Market Session Logic (approximate standard hours)
  const isSydney = utcHour >= 21 || utcHour < 6;
  const isTokyo = utcHour >= 0 && utcHour < 9;
  const isLondon = utcHour >= 7 && utcHour < 16;
  const isNY = utcHour >= 13 && utcHour < 22;

  const SessionBadge = ({ name, active }: { name: string; active: boolean }) => (
    <div className={clsx(
      "px-3 py-1 rounded-full text-[10px] font-bold tracking-wider flex items-center gap-1.5 transition-colors",
      active ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-slate-500"
    )}>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.8)]" />}
      {name}
    </div>
  );

  return (
    <div className="bg-[#0a1120] border-b border-white/[0.06] px-4 py-2.5 flex items-center justify-between sticky top-0 z-30 md:static">
      <div className="flex items-center gap-3">
        <div className="p-1.5 bg-blue-500/10 rounded-md hidden md:block">
          <Globe className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <div className="font-mono text-sm tracking-tight text-slate-200">
            {time.toISOString().split('T')[1].split('.')[0]} <span className="text-slate-500 text-xs">UTC</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 md:gap-2">
        <SessionBadge name="SYD" active={isSydney} />
        <SessionBadge name="TOK" active={isTokyo} />
        <SessionBadge name="LON" active={isLondon} />
        <SessionBadge name="NY" active={isNY} />
      </div>
    </div>
  );
}