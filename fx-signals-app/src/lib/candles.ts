// Live 4H + Daily candle fetcher for EMA-50, ATR, and rejection detection.
// Primary: IBR Live (FX only). Fallbacks: Yahoo chart, then Twelve Data.

export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type CandlePair =
  | "XAUUSD" | "EURUSD" | "GBPUSD"
  | "GBPNZD" | "EURJPY" | "CADJPY"
  | "AUDCAD" | "GBPAUD" | "EURAUD"
  | "USDCAD" | "USDCHF" | "NZDCAD" | "GBPCHF";

const YAHOO_SYMBOL: Record<CandlePair, string> = {
  // `XAUUSD=X` is delisted on Yahoo (404). `GC=F` is COMEX front-month gold
  // futures and is the working spot-gold proxy on Yahoo Finance.
  XAUUSD: "GC=F",
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  GBPNZD: "GBPNZD=X",
  EURJPY: "EURJPY=X",
  CADJPY: "CADJPY=X",
  AUDCAD: "AUDCAD=X",
  GBPAUD: "GBPAUD=X",
  EURAUD: "EURAUD=X",
  USDCAD: "USDCAD=X",
  USDCHF: "USDCHF=X",
  NZDCAD: "NZDCAD=X",
  GBPCHF: "GBPCHF=X",
};

const TD_SYMBOL: Record<CandlePair, string> = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  GBPNZD: "GBP/NZD",
  EURJPY: "EUR/JPY",
  CADJPY: "CAD/JPY",
  AUDCAD: "AUD/CAD",
  GBPAUD: "GBP/AUD",
  EURAUD: "EUR/AUD",
  USDCAD: "USD/CAD",
  USDCHF: "USD/CHF",
  NZDCAD: "NZD/CAD",
  GBPCHF: "GBP/CHF",
};

// IBR Live covers these FX pairs (no gold)
const IBR_SYMBOL: Partial<Record<CandlePair, string>> = {
  EURUSD: "EURUSD", GBPUSD: "GBPUSD", GBPNZD: "GBPNZD",
  EURJPY: "EURJPY", CADJPY: "CADJPY", AUDCAD: "AUDCAD",
  GBPAUD: "GBPAUD", EURAUD: "EURAUD", USDCAD: "USDCAD",
  USDCHF: "USDCHF", NZDCAD: "NZDCAD", GBPCHF: "GBPCHF",
};

const IBR_BASE = "https://api.ibrlive.com/api";

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; candles: Candle[] }>();

/** Wraps fetch with an AbortController timeout. */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// --- IBR Live candles ------------------------------------------------------
// `aggregate/data` returns results newest-first in milliseconds; we normalize
// to oldest-first with timestamps in seconds (to match the existing shape
// the rest of the codebase expects).

type IbrAggBar = { o: number; h: number; l: number; c: number; t: number };
type IbrAggResponse = {
  success: boolean;
  data?: { results?: IbrAggBar[] };
};

async function ibrAggregate(
  pair: CandlePair,
  timeframe: "hour" | "day",
  limit: number,
  timeoutMs: number
): Promise<Candle[] | null> {
  const sym = IBR_SYMBOL[pair];
  if (!sym) return null; // e.g. XAUUSD — not supported by IBR Live
  const apiKey = process.env.IBR_LIVE_API_KEY;
  if (!apiKey || apiKey === "your_ibr_live_key_here") return null;

  const url = `${IBR_BASE}/aggregate/data?symbol=${sym}&timeframe=${timeframe}&limit=${limit}`;
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs,
      cache: "no-store",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`[candles:ibrlive:${timeframe}] ${pair} HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as IbrAggResponse;
    if (!data.success) return null;
    const bars = data.data?.results ?? [];
    if (bars.length === 0) return null;

    // Newest-first → oldest-first; t ms → s; filter out malformed rows.
    const candles: Candle[] = bars
      .slice()
      .reverse()
      .filter(
        (b) =>
          Number.isFinite(b.o) &&
          Number.isFinite(b.h) &&
          Number.isFinite(b.l) &&
          Number.isFinite(b.c) &&
          Number.isFinite(b.t)
      )
      .map((b) => ({
        t: Math.floor(b.t / 1000),
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
      }));
    return candles.length ? candles : null;
  } catch (e) {
    console.warn(`[candles:ibrlive:${timeframe}] ${pair} failed:`, (e as Error).message);
    return null;
  }
}

/** Aggregate a list of 1h candles into 4h candles (4-at-a-time, oldest-first). */
function aggregate1hTo4h(hourly: Candle[]): Candle[] {
  const fourH: Candle[] = [];
  for (let i = 0; i + 4 <= hourly.length; i += 4) {
    const slice = hourly.slice(i, i + 4);
    fourH.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map((x) => x.h)),
      l: Math.min(...slice.map((x) => x.l)),
      c: slice[3].c,
    });
  }
  return fourH;
}

async function ibrLive4h(pair: CandlePair, count: number): Promise<Candle[] | null> {
  // Fetch enough hourly bars to produce `count` 4H bars (with head-room for gaps)
  const hourly = await ibrAggregate(pair, "hour", Math.max(count * 5, 240), 8000);
  if (!hourly || hourly.length < 200) return null;
  const fourH = aggregate1hTo4h(hourly);
  const out = fourH.slice(-count);
  return out.length >= 50 ? out : null;
}

async function ibrLiveDaily(pair: CandlePair): Promise<number[] | null> {
  const daily = await ibrAggregate(pair, "day", 200, 8000);
  if (!daily) return null;
  const closes = daily.map((c) => c.c).filter((n) => Number.isFinite(n));
  return closes.length >= 50 ? closes : null;
}

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

async function yahoo4h(pair: CandlePair, count: number): Promise<Candle[] | null> {
  const sym = encodeURIComponent(YAHOO_SYMBOL[pair]);
  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${sym}?interval=1h&range=3mo`;
    try {
      const res = await fetchWithTimeout(url, {
        timeoutMs: 5000,
        cache: "no-store",
        headers: YAHOO_HEADERS,
      });
      if (res.status === 429) {
        console.warn(`[candles:yahoo:4h] ${pair} 429 on ${host}, trying next`);
        continue;
      }
      if (!res.ok) {
        console.warn(`[candles:yahoo:4h] ${pair} HTTP ${res.status} on ${host}`);
        return null;
      }
      const data = await res.json();
      const r = data?.chart?.result?.[0];
      const ts: number[] | undefined = r?.timestamp;
      const q = r?.indicators?.quote?.[0];
      const o: (number | null)[] | undefined = q?.open;
      const h: (number | null)[] | undefined = q?.high;
      const l: (number | null)[] | undefined = q?.low;
      const c: (number | null)[] | undefined = q?.close;
      if (!ts || !o || !h || !l || !c) return null;
      const hourly: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        if (
          typeof o[i] === "number" &&
          typeof h[i] === "number" &&
          typeof l[i] === "number" &&
          typeof c[i] === "number"
        ) {
          hourly.push({ t: ts[i], o: o[i]!, h: h[i]!, l: l[i]!, c: c[i]! });
        }
      }
      const fourH = aggregate1hTo4h(hourly);
      const out = fourH.slice(-count);
      return out.length >= 50 ? out : null;
    } catch (e) {
      console.warn(`[candles:yahoo:4h] ${pair} failed on ${host}:`, (e as Error).message);
    }
  }
  return null;
}

async function twelveData4h(pair: CandlePair, count: number): Promise<Candle[] | null> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey || apiKey === "your_twelvedata_key_here") return null;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    TD_SYMBOL[pair]
  )}&interval=4h&outputsize=${count}&apikey=${apiKey}`;
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 8000, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.status === "error") return null;
    const values: Array<{ datetime: string; open: string; high: string; low: string; close: string }> =
      data?.values ?? [];
    if (values.length < 50) return null;
    const candles = values
      .map((v) => ({
        t: Math.floor(new Date(v.datetime).getTime() / 1000),
        o: parseFloat(v.open),
        h: parseFloat(v.high),
        l: parseFloat(v.low),
        c: parseFloat(v.close),
      }))
      .filter((c) => Number.isFinite(c.o) && Number.isFinite(c.c))
      .reverse();
    return candles.length >= 50 ? candles : null;
  } catch {
    return null;
  }
}

export async function fetchCandles4h(pair: CandlePair, count = 60): Promise<Candle[] | null> {
  const key = `4h:${pair}:${count}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.candles;

  // IBR Live → Yahoo → Twelve Data. IBR Live returns null for XAUUSD
  // (unsupported), so gold naturally falls through to Yahoo.
  let candles = await ibrLive4h(pair, count);
  if (!candles) candles = await yahoo4h(pair, count);
  if (!candles) candles = await twelveData4h(pair, count);

  if (candles) {
    cache.set(key, { at: Date.now(), candles });
    return candles;
  }
  if (hit) {
    console.warn(`[candles:4h] ${pair} using stale cache`);
    return hit.candles;
  }
  return null;
}

async function yahooDaily(pair: CandlePair): Promise<number[] | null> {
  const sym = encodeURIComponent(YAHOO_SYMBOL[pair]);
  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${sym}?interval=1d&range=1y`;
    try {
      const res = await fetchWithTimeout(url, {
        timeoutMs: 5000,
        cache: "no-store",
        headers: YAHOO_HEADERS,
      });
      if (res.status === 429) {
        console.warn(`[candles:yahoo:daily] ${pair} 429 on ${host}, trying next`);
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const closes: (number | null)[] | undefined =
        data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (!closes) return null;
      const clean = closes.filter((c): c is number => typeof c === "number");
      return clean.length >= 50 ? clean : null;
    } catch {
      // try next host
    }
  }
  return null;
}

async function twelveDataDaily(pair: CandlePair): Promise<number[] | null> {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey || apiKey === "your_twelvedata_key_here") return null;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    TD_SYMBOL[pair]
  )}&interval=1day&outputsize=100&apikey=${apiKey}`;
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 8000, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const values: Array<{ close: string }> = data?.values ?? [];
    const closes = values
      .map((v) => parseFloat(v.close))
      .filter((n) => Number.isFinite(n))
      .reverse();
    return closes.length >= 50 ? closes : null;
  } catch {
    return null;
  }
}

const dailyCache = new Map<string, { at: number; closes: number[] }>();

export async function fetchClosesDaily(pair: CandlePair): Promise<number[] | null> {
  const key = `1d:${pair}`;
  const hit = dailyCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.closes;

  // IBR Live → Yahoo → Twelve Data (XAUUSD falls through to Yahoo automatically).
  let closes = await ibrLiveDaily(pair);
  if (!closes) closes = await yahooDaily(pair);
  if (!closes) closes = await twelveDataDaily(pair);

  if (closes) {
    dailyCache.set(key, { at: Date.now(), closes });
    return closes;
  }
  return hit?.closes ?? null;
}

export async function fetchCloses4h(pair: CandlePair, count = 60): Promise<number[] | null> {
  const candles = await fetchCandles4h(pair, count);
  return candles ? candles.map((c) => c.c) : null;
}

// ---------------------------------------------------------------------------
// 1H candles — used for entry-timeframe rejection check (1H/15m per strategy)
// Reuses the Yahoo 1h route already fetched for 4H aggregation, but returns
// raw 1H bars. TTL is 15 minutes (much shorter than 4H at 30 min).
// ---------------------------------------------------------------------------

const cache1h = new Map<string, { at: number; candles: Candle[] }>();
const TTL_1H_MS = 15 * 60_000;

export async function fetchCandles1h(pair: CandlePair, count = 20): Promise<Candle[] | null> {
  const key = `1h:${pair}:${count}`;
  const hit = cache1h.get(key);
  if (hit && Date.now() - hit.at < TTL_1H_MS) return hit.candles;

  const sym = encodeURIComponent(YAHOO_SYMBOL[pair]);
  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${sym}?interval=1h&range=5d`;
    try {
      const res = await fetchWithTimeout(url, {
        timeoutMs: 5000,
        cache: "no-store",
        headers: YAHOO_HEADERS,
      });
      if (res.status === 429) { continue; }
      if (!res.ok) break;
      const data = await res.json();
      const r = data?.chart?.result?.[0];
      const ts: number[] | undefined = r?.timestamp;
      const q = r?.indicators?.quote?.[0];
      if (!ts || !q?.open) break;
      const candles: Candle[] = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
        if (typeof o === "number" && typeof h === "number" && typeof l === "number" && typeof c === "number") {
          candles.push({ t: ts[i], o, h, l, c });
        }
      }
      const out = candles.slice(-count);
      if (out.length >= 5) {
        cache1h.set(key, { at: Date.now(), candles: out });
        return out;
      }
      break;
    } catch { /* try next host */ }
  }
  return hit?.candles ?? null;
}
