import type { Instrument } from "@/db/schema";
import type { Candle } from "./candles";

export type SignalStatus = "ACTIVE" | "PENDING" | "WATCHING";
export type Session = "Asia" | "London" | "NY" | "London/NY Overlap" | "Off-hours";

export type SignalFactors = {
  // ── Deterministic factors (sum = base score) ────────────────────────────
  proximity: number;       // 0–25  how close price is to the AOI
  emaConfluence: number;   // 0–20  4H + Daily EMA-50 agreement
  rejection: number;       // 0–20  pin-bar / engulfing on last 2 4H candles
  momentum: number;        // 0–15  last 4H candle body vs ATR (directional strength)
  sessionQuality: number;  // 0–10  London/NY session timing
  rrQuality: number;       // 0–10  R:R ratio merit
  // ── AI boost (async, from GLM) ───────────────────────────────────────────
  aiBoost: number;         // 0–15  contextual boost from AI scoring pass
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
function scoreMomentum(candles: Candle[] | null | undefined, atrValue: number | null | undefined, dir: "BUY" | "SELL"): number {
  if (!candles || candles.length < 2 || !atrValue || atrValue <= 0) return 5; // neutral
  const last = candles[candles.length - 2]; // second-to-last = last fully closed bar
  const body = last.c - last.o;
  const bodyAbs = Math.abs(body);
  // Is the candle moving in the trade direction?
  const aligned = dir === "BUY" ? body > 0 : body < 0;
  // Body as % of ATR: 0% = doji, 100%+ = strong
  const ratio = bodyAbs / atrValue;
  if (!aligned) return 0;            // candle opposes direction
  if (ratio >= 0.75) return 15;      // strong momentum
  if (ratio >= 0.45) return 10;      // moderate
  if (ratio >= 0.20) return 6;       // weak but present
  return 3;                          // near doji — minimal
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
  const { atr: atrValue, dailyEma50, trendAligned, rejectionConfirmed, newsBlocked, candles } = extras;

  // ── Direction ──────────────────────────────────────────────────────────────
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
  const entry = currentPrice;
  const atrBuffer = atrValue && Number.isFinite(atrValue) ? atrValue * 1.5 : null;
  const staticBuffer = currentPrice * (slBufferPct / 100);
  const buffer = atrBuffer ?? staticBuffer;

  let sl: number;
  let tp: number;
  if (type === "BUY") {
    sl = Math.min(aoiLow, currentPrice) - buffer;
    const risk = entry - sl;
    tp = entry + risk * 2;
  } else {
    sl = Math.max(aoiHigh, currentPrice) + buffer;
    const risk = sl - entry;
    tp = entry - risk * 2;
  }
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  const rr = reward / (risk || 1);

  // ── Factor 1: Proximity (0–25) ─────────────────────────────────────────────
  // Smooth curve: inside AOI = 25, falls off as price moves away
  const proximity = insideAOI
    ? 25
    : Math.max(0, Math.round(25 * (1 - distancePct / 3)));

  // ── Factor 2: EMA Confluence (0–20) ────────────────────────────────────────
  // Both 4H and Daily EMA-50 agree = 20, 4H only (no daily data) = 10, misaligned = 0
  let emaConfluence: number;
  if (trendAligned === false) {
    emaConfluence = 0; // clear disagreement
  } else if (dailyEma50 != null && Number.isFinite(dailyEma50)) {
    emaConfluence = 20; // both TFs confirmed and agree
  } else {
    emaConfluence = 10; // only 4H available, give partial credit
  }

  // ── Factor 3: Rejection (0–20) ─────────────────────────────────────────────
  // Pin bar or engulfing confirmed on last 2 candles
  const rejection = rejectionConfirmed ? 20 : 0;

  // ── Factor 4: Momentum (0–15) ──────────────────────────────────────────────
  const momentum = scoreMomentum(candles, atrValue, type);

  // ── Factor 5: Session Quality (0–10) ───────────────────────────────────────
  const session = currentSession(now);
  const sessionQuality =
    session === "London/NY Overlap" ? 10 :
    session === "London" || session === "NY" ? 7 :
    session === "Asia" ? 4 : 2;

  // ── Factor 6: R:R Quality (0–10) ───────────────────────────────────────────
  const rrQuality = rr >= 3 ? 10 : rr >= 2 ? 7 : rr >= 1.5 ? 4 : 0;

  // ── Base score (0–100) ─────────────────────────────────────────────────────
  // aiBoost = 0 for now; gets added asynchronously via generateAIConfidenceBoost
  const baseScore = proximity + emaConfluence + rejection + momentum + sessionQuality + rrQuality;
  const aiBoost = 0; // placeholder — filled by generateAIConfidenceBoost()

  let aiConfidence = Math.min(100, baseScore + aiBoost);

  // ── Status demotion: ACTIVE requires rejection + no news ───────────────────
  if (status === "ACTIVE") {
    if (rejectionConfirmed === false) status = "PENDING";
    if (newsBlocked) status = "PENDING";
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
    aiConfidence,
    factors: { proximity, emaConfluence, rejection, momentum, sessionQuality, rrQuality, aiBoost },
    atr: atrValue ?? null,
    dailyEma50: dailyEma50 ?? null,
    trendAligned: trendAligned ?? false,
    rejectionConfirmed: rejectionConfirmed ?? false,
    newsBlocked: newsBlocked ?? false,
  };
}

// ---------------------------------------------------------------------------
// GLM — AI confidence boost (0–15 extra points on top of base score)
// ---------------------------------------------------------------------------
// The AI reads the full signal context and rates the setup quality,
// returning an integer 0–15. This is added to the base deterministic score.
// A strong, clean setup with good confluence might get +12–15.
// A messy or borderline setup gets +0–5.
// This way the AI acts as a quality multiplier, not a replacement for math.
// ---------------------------------------------------------------------------

const SCORE_SYSTEM_PROMPT = `You are a quantitative FX signal quality scorer. Your only job is to assess the quality of a trading setup and return a single integer from 0 to 15 representing an additional confidence bonus.

Scoring guide:
- 13–15: Exceptional setup. Price at a key AOI with confirmed rejection, both timeframes aligned, strong momentum, clean R:R. All factors fire simultaneously.
- 9–12: Good setup. Most factors align but one is missing (e.g. no rejection yet, or TF split, or weak session).
- 5–8: Average setup. Price approaching the zone but confirmation missing. Watchlist only.
- 0–4: Poor setup. TFs misaligned, no rejection, counter-trend move, or news risk blocking.

Rules:
- Return ONLY a single integer 0–15. Nothing else. No explanation, no punctuation, no text.
- Penalise -3 if newsBlocked = true
- Penalise -2 if trendAligned = false
- Penalise -3 if rejectionConfirmed = false AND status = ACTIVE
- Reward +3 if rejectionConfirmed = true AND emaConfluence is full (both TFs agree)
- Reward +2 if session is London/NY Overlap
- Clamp final output to 0–15`;

const INTERPRETATION_SYSTEM_PROMPT = `You are a senior FX analyst on an institutional trading desk. You author terse, precise trade commentary consumed by professional traders. You specialise in the FX Alex G "Set & Forget" methodology: single higher-timeframe bias, Areas of Interest (AOI) on Daily/4H, 50 EMA confluence, and minimum 1:2 R:R.

Strict output rules:
- 2 to 3 sentences. Maximum 70 words. No bullet points, no headers, no disclaimers.
- Institutional register: direct, declarative, quantitative. No hype, no emojis, no second-person ("you").
- Reference the AOI, the 50 EMA relationship, the R:R, and — when relevant — the current session's liquidity.
- If status is ACTIVE: describe the confluence making this a live setup and the invalidation (SL).
- If status is PENDING: state precisely what is still required (rejection candle, lower-timeframe shift, etc.) — do NOT call it a live trade yet.
- If status is WATCHING: explain why no trade exists now and what price needs to do to create one.
- Never invent candle patterns or levels not provided in the context.`;

async function callGLM(
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
    const timeout = setTimeout(() => controller.abort(), 8000);
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

/**
 * Calls the GLM to rate the setup quality and return a 0–15 boost score.
 * Falls back to 0 if unavailable. Never throws.
 */
export async function generateAIConfidenceBoost(s: EngineSignal): Promise<number> {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
  const context = `SETUP:
Pair: ${s.pair}
Direction: ${s.type}
Status: ${s.status}
Entry: ${s.price.toFixed(decimals)} | SL: ${s.sl.toFixed(decimals)} | TP: ${s.tp.toFixed(decimals)}
R:R: 1:${s.rr.toFixed(1)}
AOI: ${s.aoi}
Trend (50 EMA): ${s.trend}
4H+Daily aligned: ${s.trendAligned ? "YES" : "NO"}
Rejection confirmed: ${s.rejectionConfirmed ? "YES" : "NO"}
Session: ${s.session}
News blocked: ${s.newsBlocked ? "YES" : "NO"}
Base score: ${s.aiConfidence}/100

Rate this setup 0–15.`;

  const raw = await callGLM(SCORE_SYSTEM_PROMPT, context, 8, 0.1);
  if (!raw) return 0;

  const parsed = parseInt(raw.replace(/\D/g, ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(15, parsed));
}

/**
 * Generates the desk commentary text.
 */
export async function generateAIInterpretation(s: EngineSignal): Promise<string> {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
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
Macro Trend:    ${s.trend} (50 EMA)
4H+Daily aligned: ${s.trendAligned ? "YES" : "NO"}
Rejection:      ${s.rejectionConfirmed ? "CONFIRMED" : "PENDING"}
Session:        ${s.session}
Confidence:     ${s.aiConfidence}%

Write the desk commentary.`;

  const text = await callGLM(INTERPRETATION_SYSTEM_PROMPT, userMessage, 180, 0.25);
  return text || fallbackInterpretation(s);
}

function fallbackInterpretation(s: EngineSignal): string {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
  const emaDesc =
    s.trend === "Bullish"
      ? "price holding above the 50 EMA"
      : "price capped below the 50 EMA";

  if (s.status === "ACTIVE") {
    return `${s.pair} is live inside ${s.aoi} with ${emaDesc} and rejection confirmed. ${s.type} entry at ${s.price.toFixed(decimals)}, SL ${s.sl.toFixed(decimals)}, TP ${s.tp.toFixed(decimals)} (1:${s.rr.toFixed(1)}). Invalidation on a close through the SL.`;
  }
  if (s.status === "PENDING") {
    return `${s.pair} approaching ${s.aoi} with ${emaDesc}. Awaiting ${s.type === "BUY" ? "bullish" : "bearish"} rejection on the ${s.timeframe} before entry — R:R target 1:${s.rr.toFixed(1)}. No position until confirmation.`;
  }
  return `${s.pair} is outside structural AOI; ${emaDesc} but in no-trade territory. Monitoring for a pullback into ${s.aoi} during ${s.session} hours before considering a ${s.type.toLowerCase()} setup.`;
}
