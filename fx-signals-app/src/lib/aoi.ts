// Auto-AOI recompute from recent 4H swings.
//
// Alex G's "Areas of Interest" are zones where price has reacted strongly in
// the recent past. Static instrument config goes stale fast. This module
// extracts pivot highs/lows from 4H candles, clusters them into zones, and
// returns the most relevant band relative to current price.

import type { Candle } from "./candles";

export type AoiZone = {
  low: number;
  high: number;
  /** Number of pivot touches inside the band (more = stronger zone). */
  touches: number;
  /** Most recent timestamp the band was tested. */
  lastTouch: number;
};

export type AoiResult = {
  /** Support: nearest band BELOW current price. */
  support: AoiZone | null;
  /** Resistance: nearest band ABOVE current price. */
  resistance: AoiZone | null;
};

// ---------------------------------------------------------------------------
// Pivot detection
// ---------------------------------------------------------------------------
type Pivot = { idx: number; t: number; price: number; kind: "high" | "low" };

/**
 * A bar is a pivot high if its high is strictly greater than the highs of the
 * `lookback` bars on each side. Same for pivot lows. Symmetric window.
 */
function findPivots(candles: Candle[], lookback = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].h >= c.h || candles[i + j].h >= c.h) isHigh = false;
      if (candles[i - j].l <= c.l || candles[i + j].l <= c.l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ idx: i, t: c.t, price: c.h, kind: "high" });
    if (isLow) pivots.push({ idx: i, t: c.t, price: c.l, kind: "low" });
  }
  return pivots;
}

// ---------------------------------------------------------------------------
// Cluster pivots into zones (within tolerance%)
// ---------------------------------------------------------------------------
function clusterPivots(pivots: Pivot[], tolerancePct: number): AoiZone[] {
  if (pivots.length === 0) return [];
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const zones: AoiZone[] = [];
  let bucket: Pivot[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    const ref = bucket[0].price;
    if (Math.abs(p.price - ref) / ref <= tolerancePct / 100) {
      bucket.push(p);
    } else {
      zones.push(toZone(bucket));
      bucket = [p];
    }
  }
  zones.push(toZone(bucket));
  return zones;
}

function toZone(bucket: Pivot[]): AoiZone {
  const prices = bucket.map((p) => p.price);
  return {
    low: Math.min(...prices),
    high: Math.max(...prices),
    touches: bucket.length,
    lastTouch: Math.max(...bucket.map((p) => p.t)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute support/resistance bands from 4H candles relative to current price.
 *
 * @param candles 4H OHLC, oldest → newest.
 * @param currentPrice Latest mid/close price.
 * @param tolerancePct Cluster tolerance (% of price). Defaults vary by pair scale.
 */
export function computeAoi(
  candles: Candle[],
  currentPrice: number,
  tolerancePct = 0.25
): AoiResult {
  if (!candles || candles.length < 20) {
    return { support: null, resistance: null };
  }

  const pivots = findPivots(candles, 3);
  if (pivots.length === 0) return { support: null, resistance: null };

  const zones = clusterPivots(pivots, tolerancePct);

  // Filter zones that have at least 2 touches OR are very recent (last 10 bars).
  // This keeps strong reaction levels but tolerates fresh single-touch swings.
  const recentCutoff = candles[Math.max(0, candles.length - 10)].t;
  const significant = zones.filter(
    (z) => z.touches >= 2 || z.lastTouch >= recentCutoff
  );

  // Score each zone: prioritise more touches, then more recent, then closer.
  const score = (z: AoiZone) => {
    const recencyBoost = Math.max(
      0,
      (z.lastTouch - candles[0].t) / (candles[candles.length - 1].t - candles[0].t)
    );
    return z.touches * 1.5 + recencyBoost;
  };

  const below = significant
    .filter((z) => z.high < currentPrice)
    .sort((a, b) => {
      const sd = score(b) - score(a);
      if (Math.abs(sd) > 0.001) return sd;
      // Tiebreak: closer to price wins
      return b.high - a.high;
    });
  const above = significant
    .filter((z) => z.low > currentPrice)
    .sort((a, b) => {
      const sd = score(b) - score(a);
      if (Math.abs(sd) > 0.001) return sd;
      return a.low - b.low;
    });

  return {
    support: below[0] ?? null,
    resistance: above[0] ?? null,
  };
}

/**
 * Pick the AOI band to use for a given trend bias.
 * BUY (bullish bias) → support below price.
 * SELL (bearish bias) → resistance above price.
 */
export function pickAoiForBias(
  aoi: AoiResult,
  bias: "BUY" | "SELL"
): AoiZone | null {
  return bias === "BUY" ? aoi.support : aoi.resistance;
}

/**
 * Decide whether the new AOI is materially different from the existing one.
 * Avoids DB churn from micro-shifts.
 */
export function shouldReplaceAoi(
  oldLow: number,
  oldHigh: number,
  next: AoiZone,
  currentPrice: number
): boolean {
  // Always replace if old zone is >2% away from current price (clearly stale).
  const oldMid = (oldLow + oldHigh) / 2;
  if (Math.abs(currentPrice - oldMid) / currentPrice > 0.02) return true;

  // Replace if midpoints differ by > 0.3%.
  const newMid = (next.low + next.high) / 2;
  return Math.abs(newMid - oldMid) / oldMid > 0.003;
}
