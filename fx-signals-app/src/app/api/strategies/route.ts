import { NextResponse } from "next/server";
import { getCurrentSignals } from "@/lib/scanner";
import { getFabioAnalysis, type FabioAnalysis } from "@/lib/fabio";
import type { CandlePair } from "@/lib/candles";
import { pairDecimals } from "@/lib/signal-types";
import type { SignalRow } from "@/db/schema";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Per-pair cached Fabio analyses. Re-running tick analysis on every request
// is too expensive (≈80 ticks/pair). 90s TTL is fine for a UI panel.
// ---------------------------------------------------------------------------
type FabioCacheEntry = { at: number; analysis: FabioAnalysis };
const fabioCache = new Map<string, FabioCacheEntry>();
const TTL_MS = 90_000;

async function fabioFor(pair: string): Promise<FabioAnalysis | null> {
  const hit = fabioCache.get(pair);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.analysis;
  try {
    const analysis = await getFabioAnalysis(pair as CandlePair);
    if (!analysis) return null;
    fabioCache.set(pair, { at: Date.now(), analysis });
    return analysis;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public payload shapes
// ---------------------------------------------------------------------------
export type StrategyLane = "alex" | "fabio" | "combined";

export type AlexLaneRow = {
  source: "alex";
  pair: string;
  tvSymbol: string;
  type: "BUY" | "SELL";
  status: "ACTIVE" | "PENDING" | "WATCHING";
  price: string;
  sl: string;
  tp: string;
  rr: string;
  aoi: string;
  aiConfidence: number;
  proximity: number;
  emaConfluence: number;
  rejection: number;
  trendAligned: boolean;
  newsBlocked: boolean;
  isStale: boolean;
  aiInterpretation: string;
  enteredAt: string | null;
  locked: boolean;
};

export type FabioLaneRow = {
  source: "fabio";
  pair: string;
  tvSymbol: string;
  type: "BUY" | "SELL" | "NEUTRAL";
  status: "ACTIVE" | "PENDING" | "WATCHING";
  model: string;
  price: string;
  entry: string | null;
  sl: string | null;
  tp: string | null;
  vah: string;
  poc: string;
  val: string;
  marketState: "BALANCE" | "EXPANSION";
  isInsideValueArea: boolean;
  tickDelta: number;
  ibHigh: string | null;
  ibLow: string | null;
  aiConfidence: number;
  reasoning: string;
  aiInterpretation: string | null;
  degraded: boolean;
};

export type CombinedLaneRow = {
  source: "combined";
  pair: string;
  tvSymbol: string;
  type: "BUY" | "SELL";
  alexStatus: "ACTIVE" | "PENDING" | "WATCHING";
  fabioModel: string;
  marketState: "BALANCE" | "EXPANSION";
  // Combined levels: tighter SL (max protection), further TP (best R:R, capped 5R)
  entry: string;
  sl: string;
  tp: string;
  rr: string;
  alexConfidence: number;
  fabioConfidence: number;
  combinedConfidence: number;
  reasoning: string;
};

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------
function mapAlex(s: SignalRow): AlexLaneRow {
  const d = pairDecimals(s.pair);
  const factors = (s.factors as Record<string, unknown>) ?? {};
  const lock = (factors._locked as { at?: string } | undefined) ?? undefined;
  return {
    source: "alex",
    pair: s.pair,
    tvSymbol: s.tvSymbol,
    type: s.type as "BUY" | "SELL",
    status: s.status as "ACTIVE" | "PENDING" | "WATCHING",
    price: s.price.toFixed(d),
    sl: s.sl.toFixed(d),
    tp: s.tp.toFixed(d),
    rr: `1:${s.rr.toFixed(1)}`,
    aoi: s.aoi,
    aiConfidence: s.aiConfidence,
    proximity: Number(factors.proximity ?? 0),
    emaConfluence: Number(factors.emaConfluence ?? 0),
    rejection: Number(factors.rejection ?? 0),
    trendAligned: s.trendAligned,
    newsBlocked: s.newsBlocked,
    isStale: s.isStale,
    aiInterpretation: s.aiInterpretation,
    enteredAt: lock?.at ?? null,
    locked: !!lock,
  };
}

function fabioStatus(a: FabioAnalysis): "ACTIVE" | "PENDING" | "WATCHING" {
  if (a.signal === "NEUTRAL") return "WATCHING";
  if (a.signalModel === "NONE") return "WATCHING";
  // ACTIVE only when price has crossed the entry trigger; else PENDING.
  if (a.entryPrice == null) return "PENDING";
  const passed =
    (a.signal === "BUY" && a.currentPrice >= a.entryPrice) ||
    (a.signal === "SELL" && a.currentPrice <= a.entryPrice);
  return passed ? "ACTIVE" : "PENDING";
}

function fabioConfidence(a: FabioAnalysis): number {
  // Prefer AI score (0..1) when present; else heuristic on model strength.
  if (typeof a.aiConfidenceScore === "number") {
    return Math.round(Math.max(0, Math.min(1, a.aiConfidenceScore)) * 100);
  }
  if (a.signalModel === "NONE") return 30;
  if (a.signalModel.startsWith("TRIPLE_A")) return 80;
  if (a.signalModel.startsWith("ABSORPTION")) return 70;
  if (a.signalModel.startsWith("IB_BREAKOUT")) return 65;
  return 50;
}

function mapFabio(a: FabioAnalysis, tvSymbol: string): FabioLaneRow {
  const d = pairDecimals(a.pair);
  return {
    source: "fabio",
    pair: a.pair,
    tvSymbol,
    type: a.signal,
    status: fabioStatus(a),
    model: a.signalModel,
    price: a.currentPrice.toFixed(d),
    entry: a.entryPrice != null ? a.entryPrice.toFixed(d) : null,
    sl: a.stopLoss != null ? a.stopLoss.toFixed(d) : null,
    tp: a.targetPrice != null ? a.targetPrice.toFixed(d) : null,
    vah: a.vah.toFixed(d),
    poc: a.poc.toFixed(d),
    val: a.val.toFixed(d),
    marketState: a.marketState,
    isInsideValueArea: a.isInsideValueArea,
    tickDelta: a.tickDelta,
    ibHigh: a.ibHigh != null ? a.ibHigh.toFixed(d) : null,
    ibLow: a.ibLow != null ? a.ibLow.toFixed(d) : null,
    aiConfidence: fabioConfidence(a),
    reasoning: a.reasoning,
    aiInterpretation: a.aiInterpretation ?? null,
    degraded: a.degraded,
  };
}

function buildCombined(alex: AlexLaneRow, fabio: FabioLaneRow): CombinedLaneRow | null {
  if (fabio.type === "NEUTRAL") return null;
  if (alex.type !== fabio.type) return null;
  // Need at least one engine to be live (ACTIVE/PENDING).
  if (alex.status === "WATCHING" && fabio.status === "WATCHING") return null;

  const d = pairDecimals(alex.pair);
  const alexEntry = parseFloat(alex.price);
  const alexSL = parseFloat(alex.sl);
  const alexTP = parseFloat(alex.tp);
  const fabioSL = fabio.sl != null ? parseFloat(fabio.sl) : null;
  const fabioTP = fabio.tp != null ? parseFloat(fabio.tp) : null;

  // Tighter SL (closer to entry — preserves capital faster on invalidation).
  // Further TP (best R:R, capped at 5R).
  let sl = alexSL;
  let tp = alexTP;
  if (alex.type === "BUY") {
    if (fabioSL != null) sl = Math.max(alexSL, fabioSL); // closer to entry from below
    if (fabioTP != null) tp = Math.max(alexTP, fabioTP);
  } else {
    if (fabioSL != null) sl = Math.min(alexSL, fabioSL); // closer to entry from above
    if (fabioTP != null) tp = Math.min(alexTP, fabioTP);
  }

  const risk = Math.abs(alexEntry - sl);
  if (risk <= 0) return null;
  let reward = Math.abs(tp - alexEntry);
  const rr = reward / risk;
  if (rr > 5) {
    reward = 5 * risk;
    tp = alex.type === "BUY" ? alexEntry + reward : alexEntry - reward;
  }

  const combinedConfidence = Math.round((alex.aiConfidence + fabio.aiConfidence) / 2);
  const reasoning =
    `Alex G ${alex.type} on ${alex.aoi.split("·")[0]?.trim() || "AOI"} confirmed by ` +
    `Fabio ${fabio.model.replace(/_/g, " ").toLowerCase()} (${fabio.marketState.toLowerCase()}).`;

  return {
    source: "combined",
    pair: alex.pair,
    tvSymbol: alex.tvSymbol,
    type: alex.type,
    alexStatus: alex.status,
    fabioModel: fabio.model,
    marketState: fabio.marketState,
    entry: alexEntry.toFixed(d),
    sl: sl.toFixed(d),
    tp: tp.toFixed(d),
    rr: `1:${(reward / risk).toFixed(1)}`,
    alexConfidence: alex.aiConfidence,
    fabioConfidence: fabio.aiConfidence,
    combinedConfidence,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const { signals, state } = await getCurrentSignals();
    const alex = signals.map(mapAlex);

    // Run Fabio for every pair we have an Alex row for. Cached for 90s.
    const fabioResults = await Promise.all(
      alex.map(async (a) => {
        const analysis = await fabioFor(a.pair);
        return analysis ? mapFabio(analysis, a.tvSymbol) : null;
      })
    );
    const fabio = fabioResults.filter((r): r is FabioLaneRow => r !== null);

    // Combined = pairs where both engines agree on direction.
    const fabioByPair = new Map(fabio.map((f) => [f.pair, f]));
    const combined: CombinedLaneRow[] = [];
    for (const a of alex) {
      const f = fabioByPair.get(a.pair);
      if (!f) continue;
      const c = buildCombined(a, f);
      if (c) combined.push(c);
    }

    // Sort each lane: ACTIVE first, then PENDING, then by confidence desc.
    const order = { ACTIVE: 0, PENDING: 1, WATCHING: 2 } as const;
    alex.sort(
      (a, b) =>
        order[a.status] - order[b.status] || b.aiConfidence - a.aiConfidence
    );
    fabio.sort(
      (a, b) =>
        order[a.status] - order[b.status] || b.aiConfidence - a.aiConfidence
    );
    combined.sort((a, b) => b.combinedConfidence - a.combinedConfidence);

    return NextResponse.json(
      {
        alex,
        fabio,
        combined,
        fetchedAt: state?.lastOkAt?.toISOString() ?? new Date().toISOString(),
        activeProvider: state?.activeProvider ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "strategies error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
