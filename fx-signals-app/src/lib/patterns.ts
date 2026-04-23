// Pure price-action pattern detection on closed candles.
// Covers: pin-bar, engulfing (entry confirmation) + impulse detection (anti-FOMO).

import type { Candle } from "./candles";

export type Direction = "BUY" | "SELL";

/**
 * Pin-bar (aka "rejection candle"):
 * - body ≤ 33% of the full range
 * - tail on the rejected side ≥ 66% of range
 */
export function isPinBar(c: Candle, dir: Direction): boolean {
  const range = c.h - c.l;
  if (range <= 0) return false;
  const body = Math.abs(c.c - c.o);
  if (body / range > 0.33) return false;
  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;
  if (dir === "BUY") return lowerWick / range >= 0.66;
  return upperWick / range >= 0.66;
}

/**
 * Engulfing:
 * - current body fully covers previous body
 * - direction matches (bullish engulf previous bearish, or vice versa)
 */
export function isEngulfing(prev: Candle, curr: Candle, dir: Direction): boolean {
  const prevBullish = prev.c > prev.o;
  const currBullish = curr.c > curr.o;
  if (dir === "BUY") {
    if (!currBullish || prevBullish) return false;
    return curr.o <= prev.c && curr.c >= prev.o;
  }
  if (currBullish || !prevBullish) return false;
  return curr.o >= prev.c && curr.c <= prev.o;
}

/**
 * Check the last two closed candles for entry confirmation.
 * Accepts both 1H and 4H candle arrays.
 * Strategy: wait for pin bar or engulfing on 1H/4H before entry.
 */
export function hasRejection(candles: Candle[], dir: Direction): boolean {
  if (candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  // Last closed bar is a pin bar
  if (isPinBar(last, dir)) return true;
  // Second-to-last is a pin bar
  if (isPinBar(prev, dir)) return true;
  // Engulfing across last two bars
  if (isEngulfing(prev, last, dir)) return true;
  return false;
}

/**
 * Anti-FOMO: detect if price has just made a large impulsive move WITHOUT
 * pulling back. Strategy says never enter after a big impulsive move —
 * always wait for a pullback into the AOI.
 *
 * Method: look at the last `lookback` 1H candles. If the cumulative
 * directional move (consecutive closes in same direction) exceeds
 * `impulseAtrMultiple × ATR`, price has extended far from value.
 * Returns true when an impulse is detected (i.e. FOMO risk is high).
 *
 * @param candles1h  Recent 1H candles (at least 5)
 * @param atr        Current 14-period ATR
 * @param dir        Trade direction
 * @param lookback   How many recent 1H bars to inspect (default 6 = last 6h)
 * @param threshold  ATR multiples that define "impulsive" (default 2.0)
 */
export function isImpulsiveMove(
  candles1h: Candle[],
  atr: number,
  dir: Direction,
  lookback = 6,
  threshold = 2.0
): boolean {
  if (!candles1h || candles1h.length < 3 || atr <= 0) return false;
  const recent = candles1h.slice(-lookback);
  // Sum the directional candle bodies (only count candles moving in trade direction)
  let directionalMove = 0;
  for (const c of recent) {
    const body = c.c - c.o;
    if (dir === "BUY" && body > 0) directionalMove += body;
    if (dir === "SELL" && body < 0) directionalMove += Math.abs(body);
  }
  return directionalMove > threshold * atr;
}

/**
 * Check if the 50 EMA is inside or near the AOI band.
 * Strategy: the highest-probability entry is when price AND the 50 EMA
 * are both inside the AOI simultaneously.
 *
 * Returns a grade 0–2:
 *   2 = EMA is inside the AOI band (perfect confluence)
 *   1 = EMA is within 0.5% of the AOI midpoint (near confluence)
 *   0 = EMA is far from the AOI (no confluence)
 */
export function emaAoiConfluence(
  ema: number,
  aoiLow: number,
  aoiHigh: number
): 0 | 1 | 2 {
  if (ema >= aoiLow && ema <= aoiHigh) return 2; // inside
  const mid = (aoiLow + aoiHigh) / 2;
  const proximity = Math.abs(ema - mid) / mid;
  if (proximity <= 0.005) return 1; // within 0.5% of midpoint
  return 0;
}
