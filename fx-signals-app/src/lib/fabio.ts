import { db, schema, assertDb } from "@/db/client";
import { eq, desc } from "drizzle-orm";
import { type CandlePair } from "./candles";
import { callGLM } from "./engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Tick = {
  price: number;
  time: number;
};

export type RangeCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  timestamp: number;
  volume: number; // tick-count (no real volume in spot FX)
  isUp: boolean;
};

export type VolumeProfileBin = {
  priceLevel: number;
  volume: number;
};

export type MarketState = "BALANCE" | "EXPANSION";

export type FabioSignalModel =
  | "TRIPLE_A_LONG"
  | "TRIPLE_A_SHORT"
  | "ABSORPTION_LONG"
  | "ABSORPTION_SHORT"
  | "IB_BREAKOUT_LONG"
  | "IB_BREAKOUT_SHORT"
  | "NONE";

export type FabioAnalysis = {
  pair: string;
  candles: RangeCandle[];
  vah: number;
  val: number;
  poc: number;
  currentPrice: number;
  isInsideValueArea: boolean;
  marketState: MarketState;
  signal: "BUY" | "SELL" | "NEUTRAL";
  signalModel: FabioSignalModel;
  reasoning: string;
  aiInterpretation?: string;
  aiConfidenceScore?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLoss?: number;
  /**
   * Tick-delta proxy. Spot FX has no centralised tape, so this is NOT a real
   * Cumulative Volume Delta (no aggressive-buy vs aggressive-sell separation
   * is possible). It is a magnitude-weighted up-tick − down-tick count, in
   * units of tickSize. Treat as a coarse pressure indicator only.
   */
  tickDelta: number;
  lvns: VolumeProfileBin[];
  ibHigh: number | null;
  ibLow: number | null;
  appliedRangeTicks: number;
  binSize: number;
  degraded: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TICKS_PER_CANDLE = 40;
const PROFILE_BINS_PER_TICK = 5; // bin = 5 × tickSize → stable POC/VA
const VALUE_AREA_PCT = 0.7;
// NY cash open is 09:30 America/New_York. UTC offset depends on US DST:
//   EDT (2nd Sun Mar → 1st Sun Nov): 09:30 ET = 13:30 UTC
//   EST (rest of year):              09:30 ET = 14:30 UTC
const NY_OPEN_UTC_MIN = 30;
const IB_MINUTES = 30;

// US DST: starts 2nd Sunday of March, ends 1st Sunday of November (both at
// 02:00 local). We approximate at the day level — sufficient for IB which is
// hours away from the boundary.
function isUsDst(d: Date): boolean {
  const y = d.getUTCFullYear();
  // 2nd Sunday of March
  const mar1 = new Date(Date.UTC(y, 2, 1));
  const dstStart = new Date(Date.UTC(y, 2, 1 + ((7 - mar1.getUTCDay()) % 7) + 7));
  // 1st Sunday of November
  const nov1 = new Date(Date.UTC(y, 10, 1));
  const dstEnd = new Date(Date.UTC(y, 10, 1 + ((7 - nov1.getUTCDay()) % 7)));
  return d >= dstStart && d < dstEnd;
}

function nyOpenUtcHour(d: Date): number {
  return isUsDst(d) ? 13 : 14;
}

function getTickSize(pair: string) {
  if (pair.includes("JPY")) return 0.01;
  if (pair === "XAUUSD") return 0.1;
  return 0.0001;
}

const aiCache = new Map<string, { interpretation: string; score: number }>();

// ---------------------------------------------------------------------------
// Range candle construction
// ---------------------------------------------------------------------------
function buildRangeCandles(ticks: Tick[], rangeTarget: number): RangeCandle[] {
  const candles: RangeCandle[] = [];
  let cur: Partial<RangeCandle> | null = null;
  let vol = 0;
  for (const tick of ticks) {
    if (!cur) {
      cur = { open: tick.price, high: tick.price, low: tick.price, timestamp: tick.time };
      vol = 1;
      continue;
    }
    cur.high = Math.max(cur.high!, tick.price);
    cur.low = Math.min(cur.low!, tick.price);
    vol++;
    if ((cur.high! - cur.low!) >= rangeTarget) {
      candles.push({
        open: cur.open!,
        high: cur.high!,
        low: cur.low!,
        close: tick.price,
        timestamp: cur.timestamp!,
        volume: vol,
        isUp: tick.price >= cur.open!,
      });
      cur = null;
      vol = 0;
    }
  }
  if (cur && vol > 0) {
    const last = ticks[ticks.length - 1].price;
    candles.push({
      open: cur.open!,
      high: cur.high!,
      low: cur.low!,
      close: last,
      timestamp: cur.timestamp!,
      volume: vol,
      isUp: last >= cur.open!,
    });
  }
  return candles;
}

// ---------------------------------------------------------------------------
// Volume profile (binned)
// ---------------------------------------------------------------------------
function computeProfile(ticks: Tick[], binSize: number) {
  const map = new Map<number, number>();
  for (const t of ticks) {
    const bin = Math.round(t.price / binSize) * binSize;
    const key = Number(bin.toFixed(8));
    map.set(key, (map.get(key) || 0) + 1);
  }
  let totalVolume = 0;
  let maxVolume = 0;
  let poc = ticks[0].price;
  for (const [price, v] of map.entries()) {
    totalVolume += v;
    if (v > maxVolume) {
      maxVolume = v;
      poc = price;
    }
  }
  const target = totalVolume * VALUE_AREA_PCT;
  let cum = maxVolume;
  const sortedLevels = Array.from(map.keys()).sort((a, b) => a - b);
  const pocIdx = sortedLevels.indexOf(poc);
  let up = pocIdx + 1;
  let down = pocIdx - 1;
  let vah = poc;
  let val = poc;
  while (cum < target && (up < sortedLevels.length || down >= 0)) {
    const upPrice = up < sortedLevels.length ? sortedLevels[up] : null;
    const downPrice = down >= 0 ? sortedLevels[down] : null;
    const upVol = upPrice !== null ? map.get(upPrice) || 0 : -1;
    const downVol = downPrice !== null ? map.get(downPrice) || 0 : -1;
    if (upVol >= downVol && upPrice !== null) {
      cum += upVol;
      vah = upPrice;
      up++;
    } else if (downPrice !== null) {
      cum += downVol;
      val = downPrice;
      down--;
    } else break;
  }

  // LVNs: bins inside value area whose volume is in the bottom decile.
  const vaBins: VolumeProfileBin[] = sortedLevels
    .filter((p) => p >= val && p <= vah)
    .map((p) => ({ priceLevel: p, volume: map.get(p) || 0 }));
  const sortedByVol = [...vaBins].sort((a, b) => a.volume - b.volume);
  const lvnCount = Math.max(1, Math.floor(vaBins.length * 0.1));
  const lvns = sortedByVol.slice(0, lvnCount);

  return { poc, vah, val, totalVolume, lvns };
}

// ---------------------------------------------------------------------------
// Tick-delta proxy (NOT real CVD)
// ---------------------------------------------------------------------------
function computeTickDelta(ticks: Tick[], tickSize: number): number {
  let delta = 0;
  for (let i = 1; i < ticks.length; i++) {
    const d = ticks[i].price - ticks[i - 1].price;
    if (d === 0) continue;
    delta += d / tickSize;
  }
  return Math.round(delta);
}

// ---------------------------------------------------------------------------
// Initial Balance (first 30 min after NY open today, UTC-approximated)
// ---------------------------------------------------------------------------
function computeInitialBalance(ticks: Tick[]): { high: number | null; low: number | null } {
  if (ticks.length === 0) return { high: null, low: null };
  const last = new Date(ticks[ticks.length - 1].time);
  const ibStart = new Date(
    Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate(), nyOpenUtcHour(last), NY_OPEN_UTC_MIN, 0)
  );
  const ibEnd = new Date(ibStart.getTime() + IB_MINUTES * 60_000);
  let high: number | null = null;
  let low: number | null = null;
  for (const t of ticks) {
    if (t.time < ibStart.getTime() || t.time > ibEnd.getTime()) continue;
    if (high === null || t.price > high) high = t.price;
    if (low === null || t.price < low) low = t.price;
  }
  return { high, low };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function getFabioAnalysis(pair: CandlePair): Promise<FabioAnalysis | null> {
  assertDb();

  const rows = await db
    .select({
      price: schema.priceTicks.price,
      fetchedAt: schema.priceTicks.fetchedAt,
    })
    .from(schema.priceTicks)
    .where(eq(schema.priceTicks.pair, pair))
    .orderBy(desc(schema.priceTicks.fetchedAt))
    .limit(2000);

  if (rows.length < 50) return null;

  const ticks: Tick[] = rows
    .reverse()
    .map((r) => ({ price: Number(r.price), time: r.fetchedAt.getTime() }))
    .filter((t) => t.price > 0);
  if (ticks.length < 50) return null;

  const tickSize = getTickSize(pair);

  // Adaptive range sizing for weekends/dead pairs
  const rangesToTry = [40, 20, 10, 5, 2, 1, 0.5, 0.1];
  let rangeCandles: RangeCandle[] = [];
  let appliedRangeTicks = TICKS_PER_CANDLE;
  for (const r of rangesToTry) {
    appliedRangeTicks = r;
    rangeCandles = buildRangeCandles(ticks, r * tickSize);
    if (rangeCandles.length >= 5) break;
  }
  if (rangeCandles.length < 5) return null;
  const requiredRange = appliedRangeTicks * tickSize;
  const degraded = appliedRangeTicks < TICKS_PER_CANDLE;

  const binSize = PROFILE_BINS_PER_TICK * tickSize;
  const { poc, vah, val, lvns } = computeProfile(ticks, binSize);
  const tickDelta = computeTickDelta(ticks, tickSize);
  const ib = computeInitialBalance(ticks);

  const currentPrice = ticks[ticks.length - 1].price;
  const isInsideValueArea = currentPrice >= val && currentPrice <= vah;

  // Market state: EXPANSION if recent candles closed outside VA majority of the time.
  const RECENT = Math.min(5, rangeCandles.length);
  const recentOutside = rangeCandles.slice(-RECENT).filter((c) => c.close > vah || c.close < val).length;
  const marketState: MarketState = recentOutside >= Math.ceil(RECENT * 0.6) ? "EXPANSION" : "BALANCE";

  const lastCandle = rangeCandles[rangeCandles.length - 1];

  // -------- Signal selection ------------------------------------------------
  let signal: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  let signalModel: FabioSignalModel = "NONE";
  let reasoning = "Market is outside Value Area or chopping without a clear entry setup.";
  let entryPrice: number | undefined;
  let targetPrice: number | undefined;
  let stopLoss: number | undefined;

  // Model 1: Triple-A (Value Area Reversion / 80% rule)
  // We only want to trigger when price is *actually at the VA extreme* — i.e.
  // in the bottom 30% of the VA for a long, top 30% for a short. Anywhere
  // else inside the VA the reward-to-VAH (or VAL) is too small relative to
  // the protective stop and the fan-out's minRR=1.5 floor will reject it.
  if (marketState === "BALANCE" && isInsideValueArea) {
    const vaWidth = vah - val;
    const stopBuffer = Math.max(requiredRange, vaWidth * 0.15);
    const longZoneTop = val + vaWidth * 0.3;
    const shortZoneBottom = vah - vaWidth * 0.3;

    if (
      vaWidth > 0 &&
      currentPrice <= longZoneTop &&
      currentPrice < poc &&
      lastCandle.isUp &&
      tickDelta > 0
    ) {
      const e = currentPrice;
      const tp = vah;
      const sl = val - stopBuffer;
      const rr = (tp - e) / (e - sl);
      if (rr >= 1.5) {
        signal = "BUY";
        signalModel = "TRIPLE_A_LONG";
        reasoning =
          "Triple-A long: price at VAL with positive tick-delta. 80% rule targets the opposite VA extreme (VAH).";
        entryPrice = e;
        targetPrice = tp;
        stopLoss = sl;
      } else {
        reasoning = `VAL bounce setup but RR ${rr.toFixed(2)} < 1.5 — entry too far from VAL.`;
      }
    } else if (
      vaWidth > 0 &&
      currentPrice >= shortZoneBottom &&
      currentPrice > poc &&
      !lastCandle.isUp &&
      tickDelta < 0
    ) {
      const e = currentPrice;
      const tp = val;
      const sl = vah + stopBuffer;
      const rr = (e - tp) / (sl - e);
      if (rr >= 1.5) {
        signal = "SELL";
        signalModel = "TRIPLE_A_SHORT";
        reasoning =
          "Triple-A short: price at VAH with negative tick-delta. 80% rule targets the opposite VA extreme (VAL).";
        entryPrice = e;
        targetPrice = tp;
        stopLoss = sl;
      } else {
        reasoning = `VAH rejection setup but RR ${rr.toFixed(2)} < 1.5 — entry too far from VAH.`;
      }
    } else {
      reasoning = "Inside Value Area but not at the extremes. Wait for a VAL bounce or VAH rejection.";
    }
  }

  // Model 2: Absorption / VA-break retest (expansion phase)
  // Strategy doc framing: "price explodes out of a range … wait for a pull-
  // back that fails to follow through, then continuation". Practical, fan-
  // outable version: enter on the breakout candle while still close to the
  // broken VA edge, stop just back inside the VA, target one full VA width
  // beyond the break ("break-of-range projection").
  // The previous implementation used the nearest LVN as the stop anchor,
  // which produced absurdly wide stops (LVN deep inside VA) and a TP
  // proportional to the small breakout distance — RR almost never cleared
  // 1.5, so the model was effectively dead.
  if (signalModel === "NONE" && marketState === "EXPANSION" && lvns.length > 0) {
    const vaWidth = vah - val;
    const nearestLvn = lvns
      .map((l) => ({ ...l, dist: Math.abs(currentPrice - l.priceLevel) }))
      .sort((a, b) => a.dist - b.dist)[0];
    if (vaWidth > 0 && currentPrice > vah && lastCandle.isUp && tickDelta > 0) {
      const e = currentPrice;
      const sl = vah - Math.max(requiredRange, vaWidth * 0.1);
      const tp = e + vaWidth;
      const rr = (tp - e) / (e - sl);
      if (rr >= 1.5) {
        signal = "BUY";
        signalModel = "ABSORPTION_LONG";
        reasoning = `Expansion long: price broke above VAH (${vah.toFixed(5)}) with positive delta; LVN @ ${nearestLvn.priceLevel.toFixed(5)} acted as ignition. Stop below VAH, target +1 VA width.`;
        entryPrice = e;
        targetPrice = tp;
        stopLoss = sl;
      } else {
        reasoning = `VAH break long but RR ${rr.toFixed(2)} < 1.5 — entry too extended.`;
      }
    } else if (vaWidth > 0 && currentPrice < val && !lastCandle.isUp && tickDelta < 0) {
      const e = currentPrice;
      const sl = val + Math.max(requiredRange, vaWidth * 0.1);
      const tp = e - vaWidth;
      const rr = (e - tp) / (sl - e);
      if (rr >= 1.5) {
        signal = "SELL";
        signalModel = "ABSORPTION_SHORT";
        reasoning = `Expansion short: price broke below VAL (${val.toFixed(5)}) with negative delta; LVN @ ${nearestLvn.priceLevel.toFixed(5)} acted as ignition. Stop above VAL, target −1 VA width.`;
        entryPrice = e;
        targetPrice = tp;
        stopLoss = sl;
      } else {
        reasoning = `VAL break short but RR ${rr.toFixed(2)} < 1.5 — entry too extended.`;
      }
    }
  }

  // Model 3: Initial Balance breakout
  if (signalModel === "NONE" && ib.high !== null && ib.low !== null) {
    const ibRange = ib.high - ib.low;
    if (currentPrice > ib.high && lastCandle.isUp && tickDelta > 0) {
      const e = currentPrice;
      const tp = e + ibRange;
      const sl = ib.high - requiredRange;
      const rr = sl < e ? (tp - e) / (e - sl) : 0;
      if (rr >= 1.5) {
        signal = "BUY";
        signalModel = "IB_BREAKOUT_LONG";
        reasoning = `IB breakout long: price cleared the NY Initial Balance high (${ib.high.toFixed(5)}).`;
        entryPrice = e;
        targetPrice = tp;
        stopLoss = sl;
      } else {
        reasoning = `IB long breakout but RR ${rr.toFixed(2)} < 1.5 — skipping.`;
      }
    } else if (currentPrice < ib.low && !lastCandle.isUp && tickDelta < 0) {
      const e = currentPrice;
      const tp = e - ibRange;
      const sl = ib.low + requiredRange;
      const rr = sl > e ? (e - tp) / (sl - e) : 0;
      if (rr >= 1.5) {
        signal = "SELL";
        signalModel = "IB_BREAKOUT_SHORT";
        reasoning = `IB breakout short: price broke the NY Initial Balance low (${ib.low.toFixed(5)}).`;
        entryPrice = e;
        targetPrice = tp;
        stopLoss = sl;
      } else {
        reasoning = `IB short breakout but RR ${rr.toFixed(2)} < 1.5 — skipping.`;
      }
    }
  }

  // -------- AI interpretation (cached on bucketed state) -------------------
  let aiInterpretation: string | undefined;
  let aiConfidenceScore: number | undefined;
  try {
    const decimals = pair.includes("JPY") ? 3 : 5;
    const round = (n: number) => Math.round(n / binSize) * binSize;
    const bucketedDelta = Math.round(tickDelta / 25);
    const stateKey = [
      pair,
      round(currentPrice).toFixed(decimals),
      round(vah).toFixed(decimals),
      round(poc).toFixed(decimals),
      round(val).toFixed(decimals),
      bucketedDelta,
      marketState,
      signalModel,
    ].join("|");

    const cached = aiCache.get(stateKey);
    if (cached) {
      aiInterpretation = cached.interpretation;
      aiConfidenceScore = cached.score;
    } else {
      const sysPrompt =
        "You are Fabio, an elite order-flow / Auction Market Theory tape reader. Respond with sharp desk commentary (max 4 sentences) judging whether the current state is a high-probability setup under either the Triple-A 80% rule, an LVN absorption squeeze, or an IB breakout. End with a confidence score on a new line formatted exactly as: [SCORE: X/100].";
      const userMsg = `PAIR: ${pair}
PRICE: ${currentPrice.toFixed(decimals)}
VAH/POC/VAL: ${vah.toFixed(decimals)} / ${poc.toFixed(decimals)} / ${val.toFixed(decimals)}
MARKET STATE: ${marketState}
TICK-DELTA PROXY: ${tickDelta} (${tickDelta > 0 ? "buy-pressure" : tickDelta < 0 ? "sell-pressure" : "flat"}) — note: spot FX has no real CVD, this is a proxy.
LAST RANGE-CANDLE: ${lastCandle.isUp ? "BULLISH" : "BEARISH"} close ${lastCandle.close.toFixed(decimals)}
INSIDE VA: ${isInsideValueArea ? "YES" : "NO"}
IB HIGH/LOW: ${ib.high !== null ? ib.high.toFixed(decimals) : "n/a"} / ${ib.low !== null ? ib.low.toFixed(decimals) : "n/a"}
APPLIED RANGE: ${appliedRangeTicks} ticks${degraded ? " (DEGRADED — low volatility)" : ""}
MECHANICAL SIGNAL: ${signal} (${signalModel})
MECHANICAL REASONING: ${reasoning}`;

      const aiRes = await callGLM(sysPrompt, userMsg, 600, 0.25);
      if (aiRes) {
        const m = aiRes.match(/\[SCORE:\s*(\d+)\/100\]/i);
        if (m && m[1]) aiConfidenceScore = parseInt(m[1], 10);
        aiInterpretation = aiRes.replace(/\[SCORE:\s*\d+\/100\]/i, "").trim();
        if (aiInterpretation && aiConfidenceScore !== undefined) {
          aiCache.set(stateKey, { interpretation: aiInterpretation, score: aiConfidenceScore });
          // Bounded LRU-ish: when over cap, drop the oldest 20% (insertion order).
          // Avoids the full-clear → GLM thundering-herd pattern.
          const MAX_CACHE = 1000;
          if (aiCache.size > MAX_CACHE) {
            const drop = Math.floor(MAX_CACHE * 0.2);
            const it = aiCache.keys();
            for (let i = 0; i < drop; i++) {
              const k = it.next().value;
              if (k === undefined) break;
              aiCache.delete(k);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Fabio AI generation failed", e);
  }

  return {
    pair,
    candles: rangeCandles,
    vah,
    val,
    poc,
    currentPrice,
    isInsideValueArea,
    marketState,
    signal,
    signalModel,
    reasoning,
    aiInterpretation,
    aiConfidenceScore,
    entryPrice,
    targetPrice,
    stopLoss,
    tickDelta,
    lvns,
    ibHigh: ib.high,
    ibLow: ib.low,
    appliedRangeTicks,
    binSize,
    degraded,
  };
}
