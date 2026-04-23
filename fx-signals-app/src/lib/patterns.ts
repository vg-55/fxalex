// Pure price-action pattern detection on closed candles.
// Covers: pin-bar, engulfing, impulse detection, weekly multi-factor bias, wick SL level.

import type { Candle } from "./candles";
import { ema } from "./ema";

export type Direction = "BUY" | "SELL";
export type WeeklyBias = "Bullish" | "Bearish" | "Ranging";

// ---------------------------------------------------------------------------
// Entry confirmation patterns
// ---------------------------------------------------------------------------

/**
 * Pin-bar: body ≤ 33% of range, tail on rejected side ≥ 66%.
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
 * Engulfing: current body fully wraps previous body in opposite direction.
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
 * Check last two closed candles for entry confirmation.
 * Works on both 1H (preferred) and 4H candle arrays.
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

/**
 * Returns the extreme wick level of the most recent rejection candle.
 * BUY → candle low (SL goes below this).
 * SELL → candle high (SL goes above this).
 * Returns null if no rejection candle found in last 2 bars.
 */
export function getWickLevel(candles: Candle[], dir: Direction): number | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Prefer the most recent matching candle
  const candidates: Candle[] = [];
  if (isPinBar(last, dir) || isEngulfing(prev, last, dir)) candidates.push(last);
  if (isPinBar(prev, dir)) candidates.push(prev);
  if (candidates.length === 0) return null;

  const c = candidates[0];
  return dir === "BUY" ? c.l : c.h;
}

// ---------------------------------------------------------------------------
// Anti-FOMO: impulse move detector
// ---------------------------------------------------------------------------

/**
 * Detects if price has just made a large impulsive move without pullback.
 * Returns true if cumulative directional body > threshold × ATR.
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
  let directionalMove = 0;
  for (const c of recent) {
    const body = c.c - c.o;
    if (dir === "BUY" && body > 0) directionalMove += body;
    if (dir === "SELL" && body < 0) directionalMove += Math.abs(body);
  }
  return directionalMove > threshold * atr;
}

// ---------------------------------------------------------------------------
// EMA-AOI confluence
// ---------------------------------------------------------------------------

/**
 * Grade 0–2: how well the 4H EMA-50 aligns with the AOI band.
 *   2 = EMA inside the band (perfect confluence)
 *   1 = EMA within 0.5% of band midpoint
 *   0 = EMA far from AOI
 */
export function emaAoiConfluence(emaVal: number, aoiLow: number, aoiHigh: number): 0 | 1 | 2 {
  if (emaVal >= aoiLow && emaVal <= aoiHigh) return 2;
  const mid = (aoiLow + aoiHigh) / 2;
  if (Math.abs(emaVal - mid) / mid <= 0.005) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Weekly multi-factor bias classifier
// ---------------------------------------------------------------------------

export type WeeklyBiasResult = {
  bias: WeeklyBias;
  /** Net vote score: +4 = strong bullish, −4 = strong bearish, 0 = neutral */
  netScore: number;
  /** 0–15 for factor display */
  factorScore: number;
  reasons: string[];
};

/** Detect swing highs: bars where high > both immediate neighbours. */
function swingHighs(candles: Candle[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (candles[i].h > candles[i - 1].h && candles[i].h > candles[i + 1].h) {
      result.push(candles[i].h);
    }
  }
  return result;
}

/** Detect swing lows: bars where low < both immediate neighbours. */
function swingLows(candles: Candle[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < candles.length - 1; i++) {
    if (candles[i].l < candles[i - 1].l && candles[i].l < candles[i + 1].l) {
      result.push(candles[i].l);
    }
  }
  return result;
}

/**
 * Weekly multi-factor bias: 3 independent sub-factors each cast votes.
 *
 * Sub-factor A (max ±2 votes): Swing structure HH/HL vs LH/LL
 * Sub-factor B (max ±1 vote):  Weekly EMA-10 direction
 * Sub-factor C (max ±1 vote):  Last 3 weekly candle body direction
 *
 * Result:
 *   netScore ≥ +2 → Bullish
 *   netScore ≤ −2 → Bearish
 *   otherwise     → Ranging
 */
export function weeklyBiasScore(candles: Candle[]): WeeklyBiasResult {
  const reasons: string[] = [];
  let bullishVotes = 0;
  let bearishVotes = 0;

  if (candles.length < 6) {
    return { bias: "Ranging", netScore: 0, factorScore: 5, reasons: ["insufficient weekly data"] };
  }

  // ── Sub-factor A: Swing structure ─────────────────────────────────────────
  const highs = swingHighs(candles);
  const lows = swingLows(candles);

  if (highs.length >= 2 && lows.length >= 2) {
    const hhBull = highs[highs.length - 1] > highs[highs.length - 2]; // HH
    const hlBull = lows[lows.length - 1] > lows[lows.length - 2];     // HL

    if (hhBull && hlBull) {
      bullishVotes += 2;
      reasons.push("HH+HL structure");
    } else if (!hhBull && !hlBull) {
      bearishVotes += 2;
      reasons.push("LH+LL structure");
    } else if (hhBull && !hlBull) {
      bullishVotes += 1;
      reasons.push("HH but LL (mixed)");
    } else {
      bearishVotes += 1;
      reasons.push("LH but HL (mixed)");
    }
  } else {
    reasons.push("swing structure: insufficient pivots");
  }

  // ── Sub-factor B: Weekly EMA-10 ───────────────────────────────────────────
  const closes = candles.map((c) => c.c);
  const weeklyEma = ema(closes, Math.min(10, closes.length));
  if (weeklyEma !== null) {
    const lastClose = closes[closes.length - 1];
    const emaDiff = Math.abs(lastClose - weeklyEma) / weeklyEma;
    if (emaDiff > 0.002) { // more than 0.2% away from EMA → directional
      if (lastClose > weeklyEma) {
        bullishVotes += 1;
        reasons.push("above weekly EMA-10");
      } else {
        bearishVotes += 1;
        reasons.push("below weekly EMA-10");
      }
    } else {
      reasons.push("at weekly EMA-10 (neutral)");
    }
  }

  // ── Sub-factor C: Last 3 weekly candle momentum ───────────────────────────
  const last3 = candles.slice(-3);
  const bullBodies = last3.filter((c) => c.c > c.o).length;
  const bearBodies = last3.filter((c) => c.c < c.o).length;
  if (bullBodies >= 2) {
    bullishVotes += 1;
    reasons.push(`${bullBodies}/3 bullish weekly candles`);
  } else if (bearBodies >= 2) {
    bearishVotes += 1;
    reasons.push(`${bearBodies}/3 bearish weekly candles`);
  } else {
    reasons.push("mixed weekly candle momentum");
  }

  // ── Final classification ──────────────────────────────────────────────────
  const netScore = bullishVotes - bearishVotes; // range: −4 to +4

  let bias: WeeklyBias;
  if (netScore >= 2) bias = "Bullish";
  else if (netScore <= -2) bias = "Bearish";
  else bias = "Ranging";

  // Normalise netScore (−4..+4) to factor score (0..15)
  // netScore +4 → 15, 0 → 7–8, −4 → 0
  const factorScore = Math.round(((netScore + 4) / 8) * 15);

  return { bias, netScore, factorScore, reasons };
}
