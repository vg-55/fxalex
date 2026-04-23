// News calendar guard — blocks ACTIVE signals around high-impact events.
// Source: Forex Factory's free public JSON feed (no key, no auth).

import { db, schema } from "@/db/client";
import { createHash } from "crypto";
import { gte, lte, and } from "drizzle-orm";

type FFEvent = {
  title: string;
  country: string;
  date: string; // ISO-ish, FF-specific format
  impact: string; // "High" | "Medium" | "Low"
};

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FETCH_TTL_MS = 15 * 60_000;

// Which currency codes each pair is sensitive to
const PAIR_CURRENCIES: Record<string, string[]> = {
  XAUUSD: ["USD"],
  EURUSD: ["USD", "EUR"],
  GBPUSD: ["USD", "GBP"],
};

let lastFetchAt = 0;
let lastFetchOk = false;

function parseFFDate(raw: string): Date | null {
  // Forex Factory returns strings like "2026-04-23T08:30:00-04:00"
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function hashEvent(e: FFEvent, scheduledAt: Date): string {
  return createHash("sha1")
    .update(`${e.country}|${e.title}|${scheduledAt.toISOString()}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Refresh the news_events cache from Forex Factory if stale.
 * Silent-fail: returns false on any error so caller can proceed.
 */
export async function refreshNewsIfStale(): Promise<boolean> {
  if (Date.now() - lastFetchAt < FETCH_TTL_MS && lastFetchOk) return true;

  try {
    const res = await fetch(FF_URL, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; fx-signals-scanner/1.0; +https://example.com)",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[news] HTTP ${res.status}`);
      lastFetchAt = Date.now();
      return false;
    }
    const events: FFEvent[] = await res.json();
    if (!Array.isArray(events)) return false;

    // Upsert high-impact events into news_events
    const highImpact = events.filter(
      (e) => e.impact && e.impact.toLowerCase() === "high"
    );

    for (const e of highImpact) {
      const scheduled = parseFFDate(e.date);
      if (!scheduled) continue;
      const id = hashEvent(e, scheduled);
      await db
        .insert(schema.newsEvents)
        .values({
          id,
          title: e.title,
          country: e.country,
          impact: e.impact,
          scheduledAt: scheduled,
        })
        .onConflictDoNothing({ target: schema.newsEvents.id });
    }

    lastFetchAt = Date.now();
    lastFetchOk = true;
    return true;
  } catch (e) {
    console.warn("[news] fetch failed:", (e as Error).message);
    lastFetchAt = Date.now();
    lastFetchOk = false;
    return false;
  }
}

export type UpcomingEvent = {
  id: string;
  title: string;
  country: string;
  scheduledAt: string;
  minutesUntil: number;
};

/**
 * Returns the soonest upcoming high-impact event within ±windowMinutes for a
 * given pair, or null if nothing relevant is in range.
 */
export async function nextRelevantEvent(
  pair: string,
  windowMinutes = 30
): Promise<UpcomingEvent | null> {
  const currencies = PAIR_CURRENCIES[pair] ?? [];
  if (currencies.length === 0) return null;

  const now = new Date();
  const low = new Date(now.getTime() - windowMinutes * 60_000);
  const high = new Date(now.getTime() + windowMinutes * 60_000);

  const rows = await db
    .select()
    .from(schema.newsEvents)
    .where(
      and(
        gte(schema.newsEvents.scheduledAt, low),
        lte(schema.newsEvents.scheduledAt, high)
      )
    );

  const candidates = rows.filter((r) => currencies.includes(r.country));
  if (candidates.length === 0) return null;

  // Pick the one closest to "now"
  candidates.sort(
    (a, b) =>
      Math.abs(a.scheduledAt.getTime() - now.getTime()) -
      Math.abs(b.scheduledAt.getTime() - now.getTime())
  );
  const soonest = candidates[0];
  const minutesUntil = Math.round(
    (soonest.scheduledAt.getTime() - now.getTime()) / 60_000
  );

  return {
    id: soonest.id,
    title: soonest.title,
    country: soonest.country,
    scheduledAt: soonest.scheduledAt.toISOString(),
    minutesUntil,
  };
}
