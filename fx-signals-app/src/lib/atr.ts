// Wilder's Average True Range (ATR) — volatility-aware SL sizing.

import type { Candle } from "./candles";

function trueRange(prev: Candle, curr: Candle): number {
  return Math.max(
    curr.h - curr.l,
    Math.abs(curr.h - prev.c),
    Math.abs(curr.l - prev.c)
  );
}

/**
 * Returns the latest ATR value using Wilder's smoothing (RMA), or null if
 * there are fewer than `period + 1` candles.
 */
export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(trueRange(candles[i - 1], candles[i]));
  }
  // Seed with simple average of first `period` TRs
  let current = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    current = (current * (period - 1) + trs[i]) / period;
  }
  return current;
}
