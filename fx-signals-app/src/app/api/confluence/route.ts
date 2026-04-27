import { NextResponse } from "next/server";
import { getCurrentSignals } from "@/lib/scanner";
import { getFabioAnalysis } from "@/lib/fabio";
import { type CandlePair } from "@/lib/candles";
import { pairDecimals } from "@/lib/signal-types";

export const dynamic = "force-dynamic";

// Cache fabio analyses across requests for a short window — they are expensive
// (60+ ticks per pair). Keyed by pair, expires after 60s.
type CacheEntry = { at: number; signal: "BUY" | "SELL" | "NEUTRAL"; model: string };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

async function fabioFor(pair: string): Promise<CacheEntry | null> {
  const hit = cache.get(pair);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const analysis = await getFabioAnalysis(pair as CandlePair).catch(() => null);
  if (!analysis) return null;
  const entry: CacheEntry = {
    at: Date.now(),
    signal: analysis.signal,
    model: analysis.signalModel,
  };
  cache.set(pair, entry);
  return entry;
}

// GET /api/confluence
// For every ACTIVE/PENDING signal from the Alex G engine, fetch the Fabio
// Order-Flow analysis and return a row marking when both strategies agree on
// the same direction. The dashboard surfaces these as "Double Confirmation"
// high-conviction setups.
export async function GET() {
  try {
    const { signals } = await getCurrentSignals();
    const candidates = signals.filter((s) => s.status === "ACTIVE" || s.status === "PENDING");

    const results = await Promise.all(
      candidates.map(async (s) => {
        const fabio = await fabioFor(s.pair);
        if (!fabio) {
          return {
            pair: s.pair,
            tvSymbol: s.tvSymbol,
            alex: s.type,
            alexStatus: s.status,
            fabio: null as null | "BUY" | "SELL" | "NEUTRAL",
            fabioModel: null as null | string,
            agree: false,
            entry: s.price.toFixed(pairDecimals(s.pair)),
            sl: s.sl.toFixed(pairDecimals(s.pair)),
            tp: s.tp.toFixed(pairDecimals(s.pair)),
            aiConfidence: s.aiConfidence,
          };
        }
        const agree = fabio.signal === s.type;
        return {
          pair: s.pair,
          tvSymbol: s.tvSymbol,
          alex: s.type,
          alexStatus: s.status,
          fabio: fabio.signal,
          fabioModel: fabio.model,
          agree,
          entry: s.price.toFixed(pairDecimals(s.pair)),
          sl: s.sl.toFixed(pairDecimals(s.pair)),
          tp: s.tp.toFixed(pairDecimals(s.pair)),
          aiConfidence: s.aiConfidence,
        };
      })
    );

    const confirmed = results.filter((r) => r.agree);
    return NextResponse.json(
      { confirmed, all: results, fetchedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "confluence error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
