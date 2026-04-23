// Live 4H + Daily candle fetcher for EMA-50, ATR, and rejection detection.
// Primary: Yahoo chart. Fallback: Twelve Data time_series.

export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type CandlePair = "XAUUSD" | "EURUSD" | "GBPUSD";

const YAHOO_SYMBOL: Record<CandlePair, string> = {
  XAUUSD: "XAUUSD=X",
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
};

const TD_SYMBOL: Record<CandlePair, string> = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
};

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

async function yahoo4h(pair: CandlePair, count: number): Promise<Candle[] | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    YAHOO_SYMBOL[pair]
  )}?interval=1h&range=3mo`;
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 5000,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!res.ok) {
      console.warn(`[candles:yahoo:4h] ${pair} HTTP ${res.status}`);
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
    const out = fourH.slice(-count);
    return out.length >= 50 ? out : null;
  } catch (e) {
    console.warn(`[candles:yahoo:4h] ${pair} failed:`, (e as Error).message);
    return null;
  }
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

  let candles = await yahoo4h(pair, count);
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    YAHOO_SYMBOL[pair]
  )}?interval=1d&range=1y`;
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 5000,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const closes: (number | null)[] | undefined =
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes) return null;
    const clean = closes.filter((c): c is number => typeof c === "number");
    return clean.length >= 50 ? clean : null;
  } catch {
    return null;
  }
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

  let closes = await yahooDaily(pair);
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
