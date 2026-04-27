import type { Instrument } from "@/db/schema";
import type { Candle } from "./candles";

export type SignalStatus = "ACTIVE" | "PENDING" | "WATCHING";
export type Session = "Asia" | "London" | "NY" | "London/NY Overlap" | "Off-hours";
export type WeeklyBias = "Bullish" | "Bearish" | "Ranging";

export type SignalFactors = {
  // ── Deterministic factors (base max = 105, capped at 100) ───────────────
  proximity: number;       // 0–25  price distance from AOI
  emaConfluence: number;   // 0–20  4H+Daily EMA-50 inside/near AOI
  weeklyTrend: number;     // 0–15  weekly multi-factor bias alignment (NEW)
  rejection: number;       // 0–15  1H pin-bar / engulfing confirmation
  momentum: number;        // 0–10  last 4H candle body/ATR directional strength
  sessionQuality: number;  // 0–10  London/NY timing
  rrQuality: number;       // 0–10  actual R:R ratio merit
  // ── AI boost (async, GLM scoring pass) ──────────────────────────────────
  aiBoost: number;         // 0–15  contextual AI quality score
  /** Weekly bias stored in JSONB factors to avoid DB column migration */
  weeklyBias?: WeeklyBias;
  /**
   * Frozen entry snapshot. Stamped the moment status first becomes ACTIVE
   * and preserved across scans until TP/SL closes the trade.
   * Lets the home card show stable Entry/SL/TP and a real time-since-entry,
   * even if price briefly leaves the AOI.
   */
  _locked?: {
    at: string;        // ISO timestamp of first ACTIVE
    entry: number;
    sl: number;
    tp: number;
    type: "BUY" | "SELL";
  };
};

export type EngineSignal = {
  pair: string;
  type: "BUY" | "SELL";
  status: SignalStatus;
  price: number;
  sl: number;
  tp: number;
  rr: number;
  aoi: string;
  timeframe: string;
  tvSymbol: string;
  session: Session;
  trend: "Bullish" | "Bearish";
  weeklyBias: WeeklyBias;
  aiConfidence: number;
  factors: SignalFactors;
  atr?: number | null;
  dailyEma50?: number | null;
  trendAligned?: boolean;
  rejectionConfirmed?: boolean;
  newsBlocked?: boolean;
};

export type BuildSignalExtras = {
  atr?: number | null;
  dailyEma50?: number | null;
  trendAligned?: boolean;
  rejectionConfirmed?: boolean;
  newsBlocked?: boolean;
  /** Last N 4H candles — used for momentum scoring */
  candles?: Candle[] | null;
  /**
   * EMA-AOI confluence grade (0/1/2):
   *   2 = 4H EMA-50 is inside the AOI band
   *   1 = within 0.5% of AOI midpoint
   *   0 = far from AOI
   */
  emaAoiGrade?: 0 | 1 | 2;
  /** True if price just made a large impulsive move — anti-FOMO gate */
  isImpulsive?: boolean;
  /**
   * Weekly multi-factor bias from 3-vote classifier.
   * "Ranging" = neutral, does not block but reduces score.
   */
  weeklyBias?: WeeklyBias;
  /** weeklyTrend factor score pre-computed (0–15) from weeklyBiasScore() */
  weeklyTrendScore?: number;
  /**
   * Wick level of the most recent rejection candle:
   * BUY → candle.low (SL goes below this)
   * SELL → candle.high (SL goes above this)
   * null = no confirmed rejection candle, use zone-based SL
   */
  rejectionCandleWick?: number | null;
};

function fmt(n: number, d: number): string {
  return n.toFixed(d);
}

export function currentSession(now: Date): Session {
  const h = now.getUTCHours();
  const london = h >= 7 && h < 16;
  const ny = h >= 12 && h < 21;
  if (london && ny) return "London/NY Overlap";
  if (london) return "London";
  if (ny) return "NY";
  if (h >= 23 || h < 7) return "Asia";
  return "Off-hours";
}

// ---------------------------------------------------------------------------
// Momentum scoring — last closed 4H candle body vs ATR
// ---------------------------------------------------------------------------
function scoreMomentum(
  candles: Candle[] | null | undefined,
  atrValue: number | null | undefined,
  dir: "BUY" | "SELL"
): number {
  if (!candles || candles.length < 2 || !atrValue || atrValue <= 0) return 4;
  const last = candles[candles.length - 2]; // last fully closed bar
  const body = last.c - last.o;
  const bodyAbs = Math.abs(body);
  const aligned = dir === "BUY" ? body > 0 : body < 0;
  const ratio = bodyAbs / atrValue;
  if (!aligned) return 0;
  if (ratio >= 0.75) return 10;
  if (ratio >= 0.45) return 7;
  if (ratio >= 0.20) return 4;
  return 2;
}

// ---------------------------------------------------------------------------
// Main signal builder
// ---------------------------------------------------------------------------
export function buildSignal(
  cfg: Pick<
    Instrument,
    "pair" | "tvSymbol" | "timeframe" | "aoiLow" | "aoiHigh" | "ma50" | "decimals" | "slBufferPct"
  >,
  currentPrice: number,
  now: Date,
  extras: BuildSignalExtras = {}
): EngineSignal {
  const { pair, tvSymbol, timeframe, aoiLow, aoiHigh, ma50, decimals, slBufferPct } = cfg;
  const aoiMid = (aoiLow + aoiHigh) / 2;
  const {
    atr: atrValue, dailyEma50, trendAligned, rejectionConfirmed, newsBlocked,
    candles, emaAoiGrade, isImpulsive, weeklyBias, weeklyTrendScore, rejectionCandleWick,
  } = extras;

  // ── Direction via 4H EMA-50 ────────────────────────────────────────────────
  const bullishTrend = currentPrice > ma50;
  const trend = bullishTrend ? "Bullish" : "Bearish";
  const type = bullishTrend ? "BUY" : "SELL";

  // ── AOI status ─────────────────────────────────────────────────────────────
  const distancePct = (Math.abs(currentPrice - aoiMid) / aoiMid) * 100;
  const tolerancePct = 0.2;
  const insideAOI =
    currentPrice >= aoiLow * (1 - tolerancePct / 100) &&
    currentPrice <= aoiHigh * (1 + tolerancePct / 100);

  let status: SignalStatus;
  if (insideAOI) status = "ACTIVE";
  else if (distancePct < 0.6) status = "PENDING";
  else status = "WATCHING";

  // ── SL / TP ────────────────────────────────────────────────────────────────
  // Strategy: when rejection is confirmed (ACTIVE), SL goes behind the candle wick.
  // For PENDING/WATCHING: SL stays at zone low/high + ATR buffer (wider, structural).
  const entry = currentPrice;
  const atrBuffer = atrValue && Number.isFinite(atrValue) ? atrValue * 1.5 : null;
  const staticBuffer = currentPrice * (slBufferPct / 100);
  const zoneBuffer = atrBuffer ?? staticBuffer;

  // Wick-based SL: tighter — behind actual rejection candle wick (ACTIVE only)
  const wickBuffer = atrValue && Number.isFinite(atrValue) ? atrValue * 0.5 : staticBuffer * 0.33;
  const useWickSl = insideAOI && rejectionConfirmed && rejectionCandleWick != null;

  let sl: number;
  let tp: number;

  if (type === "BUY") {
    if (useWickSl) {
      // SL = wick low of rejection candle minus small ATR buffer
      sl = rejectionCandleWick! - wickBuffer;
    } else {
      sl = Math.min(aoiLow, currentPrice) - zoneBuffer;
    }
    const risk = entry - sl;
    tp = entry + risk * 2;
  } else {
    if (useWickSl) {
      // SL = wick high of rejection candle plus small ATR buffer
      sl = rejectionCandleWick! + wickBuffer;
    } else {
      sl = Math.max(aoiHigh, currentPrice) + zoneBuffer;
    }
    const risk = sl - entry;
    tp = entry - risk * 2;
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rr = reward / (risk || 1);

  // ── Factor 1: Proximity (0–25) ─────────────────────────────────────────────
  const proximity = insideAOI
    ? 25
    : Math.max(0, Math.round(25 * (1 - distancePct / 3)));

  // ── Factor 2: EMA Confluence (0–20) ────────────────────────────────────────
  // Checks both TF alignment AND whether EMA is inside/near the AOI.
  let emaConfluence: number;
  if (trendAligned === false) {
    emaConfluence = 0;
  } else {
    const grade = emaAoiGrade ?? 0;
    const gradeScore = grade === 2 ? 20 : grade === 1 ? 12 : 4;
    const dailyPenalty = (dailyEma50 != null && Number.isFinite(dailyEma50)) ? 0 : -4;
    emaConfluence = Math.max(0, Math.min(20, gradeScore + dailyPenalty));
  }

  // ── Factor 3: Weekly Trend (0–15) ──────────────────────────────────────────
  // Pre-computed from weeklyBiasScore() in scanner. Falls back to neutral (7) if unavailable.
  const weeklyTrend = weeklyTrendScore != null
    ? Math.max(0, Math.min(15, weeklyTrendScore))
    : 7; // neutral fallback when weekly data unavailable

  // ── Factor 4: Rejection (0–15) ─────────────────────────────────────────────
  const rejection = rejectionConfirmed ? 15 : 0;

  // ── Factor 5: Momentum (0–10) ──────────────────────────────────────────────
  const momentum = scoreMomentum(candles, atrValue, type);

  // ── Factor 6: Session Quality (0–10) ───────────────────────────────────────
  const session = currentSession(now);
  const sessionQuality =
    session === "London/NY Overlap" ? 10 :
    session === "London" || session === "NY" ? 7 :
    session === "Asia" ? 4 : 2;

  // ── Factor 7: R:R Quality (0–10) ───────────────────────────────────────────
  const rrQuality = rr >= 3 ? 10 : rr >= 2 ? 7 : rr >= 1.5 ? 4 : 0;

  // ── Base score (sum max = 105, capped at 100) ──────────────────────────────
  const baseScore = proximity + emaConfluence + weeklyTrend + rejection + momentum + sessionQuality + rrQuality;
  const aiBoost = 0; // filled async by generateAIConfidenceBoost()

  // Anti-FOMO penalty
  const impulsePenalty = isImpulsive ? 15 : 0;

  // Weekly opposing trade penalty / ranging cap
  const wBias = weeklyBias ?? "Ranging";
  const weeklyOpposes = (wBias === "Bearish" && type === "BUY") || (wBias === "Bullish" && type === "SELL");
  const weeklyPenalty = weeklyOpposes ? 10 : 0;

  let aiConfidence = Math.max(0, Math.min(100, baseScore + aiBoost - impulsePenalty - weeklyPenalty));

  // Ranging weekly: cap confidence at 65 (no strong macro edge)
  if (wBias === "Ranging") aiConfidence = Math.min(65, aiConfidence);

  // ── Status demotion gates ──────────────────────────────────────────────────
  if (status === "ACTIVE") {
    if (rejectionConfirmed === false) status = "PENDING"; // no confirmation yet
    if (newsBlocked) status = "PENDING";                  // news risk
    if (isImpulsive) status = "PENDING";                  // anti-FOMO
    if (weeklyOpposes) status = "PENDING";                // weekly opposes trade direction
  }

  const aoi = `${type === "BUY" ? "Support" : "Resistance"} (${fmt(aoiLow, decimals)}–${fmt(aoiHigh, decimals)})`;

  return {
    pair,
    type,
    status,
    price: entry,
    sl,
    tp,
    rr,
    aoi,
    timeframe,
    tvSymbol,
    session,
    trend: trend as "Bullish" | "Bearish",
    weeklyBias: wBias,
    aiConfidence,
    factors: {
      proximity,
      emaConfluence,
      weeklyTrend,
      rejection,
      momentum,
      sessionQuality,
      rrQuality,
      aiBoost,
      weeklyBias: wBias, // stored in JSONB factors to avoid DB migration
    },
    atr: atrValue ?? null,
    dailyEma50: dailyEma50 ?? null,
    trendAligned: trendAligned ?? false,
    rejectionConfirmed: rejectionConfirmed ?? false,
    newsBlocked: newsBlocked ?? false,
  };
}

// ---------------------------------------------------------------------------
// GLM calls — shared helper
// ---------------------------------------------------------------------------

export async function callGLM(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  temperature: number
): Promise<string | null> {
  const baseUrl = process.env.GLM_BASE_URL;
  const apiKey = process.env.GLM_API_KEY;
  const model = process.env.GLM_MODEL ?? "glm-4-flash";

  if (
    !baseUrl || !apiKey ||
    baseUrl === "https://your-glm-endpoint.com/v1" ||
    apiKey === "your_glm_api_key_here"
  ) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // Increased timeout to 20s for reasoning models
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature,
        top_p: 0.9,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.choices?.[0]?.message?.content as string)?.trim() ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI confidence boost (0–15 extra points)
// ---------------------------------------------------------------------------

const SCORE_SYSTEM_PROMPT = `You are a quantitative FX signal quality scorer specialising in the Alex G Set & Forget methodology. Return a single integer 0–15 representing an additional confidence bonus for the setup.

Scoring guide:
- 13–15: Exceptional. All factors fire: price in AOI, 50 EMA inside zone, 1H rejection confirmed, weekly trend aligned, strong momentum, clean R:R.
- 9–12: Good. Most factors align — one missing (e.g. no rejection yet, ranging weekly, or weak session).
- 5–8: Average. Price approaching zone but confirmation incomplete.
- 0–4: Poor. Weekly opposes direction, TFs misaligned, no rejection, or news risk.

Penalties (apply before returning):
  -3 if newsBlocked = YES
  -3 if trendAligned = NO (4H/Daily split)
  -3 if weekly opposes trade direction
  -2 if rejectionConfirmed = NOT YET and status = ACTIVE

Rewards:
  +3 if rejectionConfirmed = YES AND EMA inside AOI AND weekly aligns
  +2 if session = London/NY Overlap
  +1 if wick-based SL used (tighter, more precise)

Return ONLY a single integer 0–15. No explanation, no punctuation.`;

const INTERPRETATION_SYSTEM_PROMPT = `You are a senior FX analyst on an institutional trading desk. You specialise in the FX Alex G "Set & Forget" methodology: single higher-timeframe bias, Areas of Interest (AOI) on Weekly/Daily/4H, 50 EMA confluence, and minimum 1:2 R:R.

Rules:
- 2–3 sentences, maximum 75 words. No bullets, no headers, no disclaimers.
- Institutional register: direct, declarative, quantitative. No hype, no emojis.
- Reference the AOI, 50 EMA position relative to zone, weekly bias, R:R, and session liquidity.
- ACTIVE: describe what is live and the SL invalidation level.
- PENDING: state exactly what is still required (rejection candle, weekly alignment, etc.).
- WATCHING: explain what price must do to create a setup.
- Never invent levels or candle patterns not in the context.`;

export async function generateAIConfidenceBoost(s: EngineSignal): Promise<number> {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
  const wickUsed = s.rejectionConfirmed && s.factors.rrQuality >= 7;

  const context = `SETUP (Alex G Set & Forget):
Pair: ${s.pair} | Direction: ${s.type} | Status: ${s.status}
Entry: ${s.price.toFixed(decimals)} | SL: ${s.sl.toFixed(decimals)} | TP: ${s.tp.toFixed(decimals)} | R:R: 1:${s.rr.toFixed(1)}
AOI zone: ${s.aoi}
Weekly bias: ${s.weeklyBias} | Weekly aligns with trade: ${
    (s.weeklyBias === "Bullish" && s.type === "BUY") ||
    (s.weeklyBias === "Bearish" && s.type === "SELL") ? "YES" : s.weeklyBias === "Ranging" ? "RANGING" : "NO"
  }
4H trend (50 EMA): ${s.trend} | 4H+Daily aligned: ${s.trendAligned ? "YES" : "NO"}
50 EMA in AOI: ${s.factors.emaConfluence >= 16 ? "YES (full)" : s.factors.emaConfluence >= 8 ? "NEAR" : "NO"}
1H rejection candle: ${s.rejectionConfirmed ? "CONFIRMED" : "NOT YET"}
SL method: ${wickUsed ? "wick-based (precise)" : "zone-based"}
Momentum (4H): ${s.factors.momentum >= 7 ? "STRONG" : s.factors.momentum >= 4 ? "MODERATE" : "WEAK"}
Session: ${s.session} | News risk: ${s.newsBlocked ? "YES" : "NO"}
Base score: ${s.aiConfidence}/100

Rate 0–15.`;

  const raw = await callGLM(SCORE_SYSTEM_PROMPT, context, 8, 0.1);
  if (!raw) return 0;
  const parsed = parseInt(raw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(15, parsed));
}

export async function generateAIInterpretation(s: EngineSignal): Promise<string> {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
  const weeklyAligns =
    (s.weeklyBias === "Bullish" && s.type === "BUY") ||
    (s.weeklyBias === "Bearish" && s.type === "SELL");

  const userMessage = `SIGNAL CONTEXT
Pair:           ${s.pair}
Direction:      ${s.type}
Status:         ${s.status}
Entry:          ${s.price.toFixed(decimals)}
Stop Loss:      ${s.sl.toFixed(decimals)}
Take Profit:    ${s.tp.toFixed(decimals)}
R:R:            1:${s.rr.toFixed(1)}
AOI:            ${s.aoi}
Timeframe:      ${s.timeframe}
Weekly bias:    ${s.weeklyBias}${weeklyAligns ? " ✓ aligned" : s.weeklyBias === "Ranging" ? " (neutral)" : " ✗ opposing"}
4H trend:       ${s.trend} (50 EMA)
4H+Daily:       ${s.trendAligned ? "ALIGNED" : "SPLIT"}
EMA in AOI:     ${s.factors.emaConfluence >= 16 ? "YES" : s.factors.emaConfluence >= 8 ? "NEAR" : "NO"}
Rejection:      ${s.rejectionConfirmed ? "CONFIRMED (1H)" : "PENDING"}
Session:        ${s.session}
Confidence:     ${s.aiConfidence}%

Write the desk commentary.`;

  const text = await callGLM(INTERPRETATION_SYSTEM_PROMPT, userMessage, 180, 0.25);
  return text || fallbackInterpretation(s);
}

function fallbackInterpretation(s: EngineSignal): string {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
  const emaDesc = s.trend === "Bullish" ? "price above 50 EMA" : "price below 50 EMA";
  const weeklyLine = s.weeklyBias !== "Ranging"
    ? `Weekly structure is ${s.weeklyBias.toLowerCase()}${
        (s.weeklyBias === "Bullish" && s.type === "BUY") ||
        (s.weeklyBias === "Bearish" && s.type === "SELL")
          ? ", aligning with the trade"
          : ", opposing the trade direction"
      }. `
    : "Weekly structure is ranging — no strong macro edge. ";

  if (s.status === "ACTIVE") {
    return `${s.pair} is live inside ${s.aoi} with ${emaDesc} and 1H rejection confirmed. ${weeklyLine}${s.type} entry at ${s.price.toFixed(decimals)}, SL ${s.sl.toFixed(decimals)}, TP ${s.tp.toFixed(decimals)} (1:${s.rr.toFixed(1)}). Close through SL invalidates.`;
  }
  if (s.status === "PENDING") {
    return `${s.pair} approaching ${s.aoi} with ${emaDesc}. ${weeklyLine}Awaiting ${s.type === "BUY" ? "bullish" : "bearish"} 1H rejection before entry — R:R target 1:${s.rr.toFixed(1)}. No position until confirmation.`;
  }
  return `${s.pair} is outside its AOI with ${emaDesc}. ${weeklyLine}Monitoring for pullback into ${s.aoi} during ${s.session} hours before considering a ${s.type.toLowerCase()} setup.`;
}
