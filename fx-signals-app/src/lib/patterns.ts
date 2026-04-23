// Pure price-action pattern detection on closed candles.
// Kept intentionally narrow: pin-bar + engulfing (most reliable + common).

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
  const bodyPct = body / range;
  if (bodyPct > 0.33) return false;

  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;

  if (dir === "BUY") {
    // bullish pin — long lower wick rejecting lower prices
    return lowerWick / range >= 0.66;
  }
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
 * Check the last two fully closed candles for rejection confirming `dir`.
 * Returns true if the most recent closed candle (index n-2) is either a
 * pin-bar or engulfing, OR if current candle (n-1) is pin-bar.
 * We exclude the last candle if it may still be forming (caller's choice
 * by slicing) — here we accept trailing bar too.
 */
export function hasRejection(candles: Candle[], dir: Direction): boolean {
  if (candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  if (isPinBar(last, dir)) return true;
  if (isPinBar(prev, dir)) return true;
  if (isEngulfing(prev, last, dir)) return true;
  return false;
}
