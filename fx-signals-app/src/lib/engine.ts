import type { Instrument } from "@/db/schema";

export type SignalStatus = "ACTIVE" | "PENDING" | "WATCHING";
export type Session = "Asia" | "London" | "NY" | "London/NY Overlap" | "Off-hours";

export type SignalFactors = {
  proximity: number;
  trendAlignment: number;
  sessionQuality: number;
  rrQuality: number;
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
  const { atr: atrValue, dailyEma50, trendAligned, rejectionConfirmed, newsBlocked } = extras;

  const bullishTrend = currentPrice > ma50;
  const trend = bullishTrend ? "Bullish" : "Bearish";
  const type = bullishTrend ? "BUY" : "SELL";

  const distancePct = (Math.abs(currentPrice - aoiMid) / aoiMid) * 100;
  const tolerancePct = 0.2;
  const insideAOI =
    currentPrice >= aoiLow * (1 - tolerancePct / 100) &&
    currentPrice <= aoiHigh * (1 + tolerancePct / 100);

  let status: SignalStatus;
  if (insideAOI) status = "ACTIVE";
  else if (distancePct < 0.6) status = "PENDING";
  else status = "WATCHING";

  // SL: prefer ATR-sized buffer when available, else static pct
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

  const proximity = insideAOI ? 40 : Math.max(0, Math.round(40 - distancePct * 40));
  // Trend alignment: full 25 if Daily & 4H agree, 10 if not (still valid, just lower conviction)
  const trendAlignment = trendAligned === false ? 10 : 25;
  const session = currentSession(now);
  const sessionQuality =
    session === "London/NY Overlap" ? 15 :
    session === "London" || session === "NY" ? 11 :
    session === "Asia" ? 6 : 3;
  const rrQuality = rr >= 3 ? 20 : rr >= 2 ? 17 : 10;

  let aiConfidence = Math.min(100, proximity + trendAlignment + sessionQuality + rrQuality);
  if (status === "WATCHING") aiConfidence = Math.min(aiConfidence, 55);

  // Gate ACTIVE on rejection + news: demote to PENDING if missing confirmation
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
    factors: { proximity, trendAlignment, sessionQuality, rrQuality },
    atr: atrValue ?? null,
    dailyEma50: dailyEma50 ?? null,
    trendAligned: trendAligned ?? false,
    rejectionConfirmed: rejectionConfirmed ?? false,
    newsBlocked: newsBlocked ?? false,
  };
}

// ---------------------------------------------------------------------------
// GLM interpretation (unchanged prompt, shared by cron + /api/signals)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior FX analyst on an institutional trading desk. You author terse, precise trade commentary consumed by professional traders. You specialise in the FX Alex G "Set & Forget" methodology: single higher-timeframe bias, Areas of Interest (AOI) on Daily/4H, 50 EMA confluence, and minimum 1:2 R:R.

Strict output rules:
- 2 to 3 sentences. Maximum 70 words. No bullet points, no headers, no disclaimers.
- Institutional register: direct, declarative, quantitative. No hype, no emojis, no second-person ("you").
- Reference the AOI, the 50 EMA relationship, the R:R, and — when relevant — the current session's liquidity.
- If status is ACTIVE: describe the confluence making this a live setup and the invalidation (SL).
- If status is PENDING: state precisely what is still required (rejection candle, lower-timeframe shift, etc.) — do NOT call it a live trade yet.
- If status is WATCHING: explain why no trade exists now and what price needs to do to create one.
- Never invent candle patterns or levels not provided in the context.`;

export async function generateAIInterpretation(s: EngineSignal): Promise<string> {
  const baseUrl = process.env.GLM_BASE_URL;
  const apiKey = process.env.GLM_API_KEY;
  const model = process.env.GLM_MODEL ?? "glm-4-flash";

  if (
    !baseUrl ||
    !apiKey ||
    baseUrl === "https://your-glm-endpoint.com/v1" ||
    apiKey === "your_glm_api_key_here"
  ) {
    return fallbackInterpretation(s);
  }

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
Macro Trend:    ${s.trend} (50 EMA proxy)
Session:        ${s.session}
Confidence:     ${s.aiConfidence}%

Write the desk commentary.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 180,
        temperature: 0.25,
        top_p: 0.9,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`GLM ${res.status}`);
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    return text.trim() || fallbackInterpretation(s);
  } catch {
    return fallbackInterpretation(s);
  }
}

function fallbackInterpretation(s: EngineSignal): string {
  const decimals = ["XAUUSD", "EURJPY", "CADJPY"].includes(s.pair) ? 2 : 4;
  const emaDesc =
    s.trend === "Bullish"
      ? "price holding above the 50 EMA as dynamic support"
      : "price capped below the 50 EMA as dynamic resistance";

  if (s.status === "ACTIVE") {
    return `${s.pair} is trading inside the ${s.aoi} with ${emaDesc}; the ${s.type.toLowerCase()} setup is live at ${s.price.toFixed(decimals)} with SL ${s.sl.toFixed(decimals)} and TP ${s.tp.toFixed(decimals)} (1:${s.rr.toFixed(1)}). ${s.session} liquidity supports the thesis — invalidation is a close through the SL.`;
  }
  if (s.status === "PENDING") {
    return `${s.pair} is pulling back toward the ${s.aoi} with ${emaDesc}. Awaiting a clean ${s.type === "BUY" ? "bullish" : "bearish"} rejection candle on the ${s.timeframe} before engaging ${s.type.toLowerCase()} — target R:R 1:${s.rr.toFixed(1)}. No position until confirmation prints.`;
  }
  return `${s.pair} is outside its structural AOI; ${emaDesc} but price is in no-trade territory. Monitoring for a pullback into ${s.aoi} during ${s.session} hours before considering a ${s.type.toLowerCase()} setup. No action now.`;
}
