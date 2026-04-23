import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Quote = {
  price: number;
  bid?: number;
  ask?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
};

export type PriceData = {
  EURUSD: Quote;
  GBPUSD: Quote;
  XAUUSD: Quote;
  source:
    | "ibrlive+yahoo"
    | "yahoo"
    | "finnhub"
    | "twelvedata"
    | "exchangerate.host"
    | "alphavantage";
  fetchedAt: string;
};

// ---------------------------------------------------------------------------
// Cache — 5s TTL; fresh enough to feel live, loose enough to absorb many tabs
// ---------------------------------------------------------------------------

let cachedPrices: PriceData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5_000;

// ---------------------------------------------------------------------------
// Provider 1: IBR Live  (PRIMARY for FX — EURUSD, GBPUSD)
//   https://api.ibrlive.com/api/forex/snapshot       — live bid/ask
//   https://api.ibrlive.com/api/forex/previous-close — prior-session OHLC
//   Auth: x-api-key header
//   IBR Live does NOT cover XAUUSD, so we patch gold in from Yahoo.
// ---------------------------------------------------------------------------

const IBR_BASE = "https://api.ibrlive.com/api";

type IbrSnapshotQuote = { s: string; a: number; b: number; t: number };
type IbrSnapshotResponse = { success: boolean; lastQuotes?: IbrSnapshotQuote[] };
type IbrPrevClose = { open: number; high: number; low: number; close: number };
type IbrPrevCloseResponse = { success: boolean; data?: IbrPrevClose };

async function ibrGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${IBR_BASE}${path}`, {
    cache: "no-store",
    headers: { "x-api-key": apiKey, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`IBR Live HTTP ${res.status} for ${path}`);
  const data = (await res.json()) as T & { success?: boolean };
  if (data && "success" in data && data.success === false) {
    throw new Error(`IBR Live error for ${path}`);
  }
  return data;
}

/** Fetch a single Yahoo symbol using the v7 quote endpoint. */
async function yahooSingle(symbol: string): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();
  const r = data?.quoteResponse?.result?.[0];
  if (!r) throw new Error(`Yahoo: missing ${symbol}`);
  const price = Number(r.regularMarketPrice);
  if (!Number.isFinite(price)) throw new Error(`Yahoo: invalid ${symbol} price`);
  return {
    price,
    bid: typeof r.bid === "number" ? r.bid : undefined,
    ask: typeof r.ask === "number" ? r.ask : undefined,
    change: typeof r.regularMarketChange === "number" ? r.regularMarketChange : undefined,
    changePercent:
      typeof r.regularMarketChangePercent === "number" ? r.regularMarketChangePercent : undefined,
    dayHigh: typeof r.regularMarketDayHigh === "number" ? r.regularMarketDayHigh : undefined,
    dayLow: typeof r.regularMarketDayLow === "number" ? r.regularMarketDayLow : undefined,
  };
}

/** Build a Quote from an IBR snapshot tick + (optional) previous-close OHLC. */
function ibrBuildQuote(tick: IbrSnapshotQuote, prev: IbrPrevClose | null): Quote {
  const price = (tick.a + tick.b) / 2; // mid
  const q: Quote = { price, bid: tick.b, ask: tick.a };
  if (prev) {
    const change = price - prev.close;
    q.change = change;
    q.changePercent = prev.close ? (change / prev.close) * 100 : undefined;
    q.dayHigh = prev.high;
    q.dayLow = prev.low;
  }
  return q;
}

/**
 * Per-pair XAUUSD cascade: IBR Live has no gold, so we try every
 * non-IBR provider in turn. Used inside `fromIbrLive` so a single
 * gold-provider failure doesn't kill the whole bundle.
 */
async function fetchXauusdViaCascade(): Promise<Quote> {
  const errors: string[] = [];

  try { return await yahooSingle("GC=F"); }
  catch (e) { errors.push(`yahoo: ${(e as Error).message}`); }

  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey && fhKey !== "your_finnhub_key_here") {
    try { return await finnhubQuote("OANDA:XAU_USD", fhKey); }
    catch (e) { errors.push(`finnhub: ${(e as Error).message}`); }
  }

  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey && tdKey !== "your_twelvedata_key_here") {
    try {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
        "XAU/USD"
      )}&apikey=${tdKey}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.status === "error") throw new Error(data.message ?? "error");
      const p = data?.close ?? data?.price;
      if (!p) throw new Error("missing close/price");
      const price = parseFloat(p);
      if (!Number.isFinite(price)) throw new Error("invalid price");
      return {
        price,
        change: data.change ? parseFloat(data.change) : undefined,
        changePercent: data.percent_change ? parseFloat(data.percent_change) : undefined,
        dayHigh: data.high ? parseFloat(data.high) : undefined,
        dayLow: data.low ? parseFloat(data.low) : undefined,
      };
    } catch (e) { errors.push(`twelvedata: ${(e as Error).message}`); }
  }

  const avKey = process.env.ALPHAVANTAGE_API_KEY;
  if (avKey && avKey !== "your_alphavantage_key_here") {
    try {
      const price = await fetchAVRate("XAU", "USD", avKey);
      return { price };
    } catch (e) { errors.push(`alphavantage: ${(e as Error).message}`); }
  }

  throw new Error(`XAUUSD unavailable: ${errors.join(" | ")}`);
}

async function fromIbrLive(apiKey: string): Promise<PriceData> {
  // Snapshot + previous-close for EURUSD & GBPUSD; XAU via per-pair cascade
  const [snapshot, prevEUR, prevGBP, xau] = await Promise.all([
    ibrGet<IbrSnapshotResponse>("/forex/snapshot", apiKey),
    ibrGet<IbrPrevCloseResponse>("/forex/previous-close?symbol=EURUSD", apiKey).catch(
      () => null as IbrPrevCloseResponse | null
    ),
    ibrGet<IbrPrevCloseResponse>("/forex/previous-close?symbol=GBPUSD", apiKey).catch(
      () => null as IbrPrevCloseResponse | null
    ),
    fetchXauusdViaCascade(),
  ]);

  const quotes: IbrSnapshotQuote[] = snapshot.lastQuotes ?? [];
  const eurTick = quotes.find((q) => q.s === "EURUSD");
  const gbpTick = quotes.find((q) => q.s === "GBPUSD");
  if (!eurTick) throw new Error("IBR Live: missing EURUSD in snapshot");
  if (!gbpTick) throw new Error("IBR Live: missing GBPUSD in snapshot");

  return {
    EURUSD: ibrBuildQuote(eurTick, prevEUR?.data ?? null),
    GBPUSD: ibrBuildQuote(gbpTick, prevGBP?.data ?? null),
    XAUUSD: xau,
    source: "ibrlive+yahoo",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Provider 2: Yahoo Finance  (full fallback — unlimited, no key)
//   query1.finance.yahoo.com/v7/finance/quote
//   Symbols: EURUSD=X, GBPUSD=X, GC=F (gold futures — XAUUSD=X is delisted)
// ---------------------------------------------------------------------------

async function fromYahoo(): Promise<PriceData> {
  const symbols = ["EURUSD=X", "GBPUSD=X", "GC=F"];
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(",")}`;

  const res = await fetch(url, {
    cache: "no-store",
    // Yahoo rejects requests without a browser-like UA
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const data = await res.json();

  const results: Array<Record<string, unknown>> = data?.quoteResponse?.result ?? [];
  if (!results.length) throw new Error("Yahoo: empty response");

  const pick = (sym: string): Quote => {
    const r = results.find((x) => x.symbol === sym);
    if (!r) throw new Error(`Yahoo: missing ${sym}`);
    const price = Number(r.regularMarketPrice);
    if (!Number.isFinite(price)) throw new Error(`Yahoo: invalid ${sym} price`);
    return {
      price,
      bid: typeof r.bid === "number" ? r.bid : undefined,
      ask: typeof r.ask === "number" ? r.ask : undefined,
      change: typeof r.regularMarketChange === "number" ? r.regularMarketChange : undefined,
      changePercent:
        typeof r.regularMarketChangePercent === "number" ? r.regularMarketChangePercent : undefined,
      dayHigh: typeof r.regularMarketDayHigh === "number" ? r.regularMarketDayHigh : undefined,
      dayLow: typeof r.regularMarketDayLow === "number" ? r.regularMarketDayLow : undefined,
    };
  };

  return {
    EURUSD: pick("EURUSD=X"),
    GBPUSD: pick("GBPUSD=X"),
    XAUUSD: pick("GC=F"),
    source: "yahoo",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Provider 2: Finnhub  (60 req/min free; FX + OANDA gold)
//   https://finnhub.io/docs/api/forex-quote
// ---------------------------------------------------------------------------

async function finnhubQuote(symbol: string, apiKey: string): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status} for ${symbol}`);
  const d = await res.json();
  const price = Number(d?.c);
  if (!Number.isFinite(price) || price === 0) {
    throw new Error(`Finnhub: invalid price for ${symbol}`);
  }
  return {
    price,
    change: typeof d.d === "number" ? d.d : undefined,
    changePercent: typeof d.dp === "number" ? d.dp : undefined,
    dayHigh: typeof d.h === "number" ? d.h : undefined,
    dayLow: typeof d.l === "number" ? d.l : undefined,
  };
}

async function fromFinnhub(apiKey: string): Promise<PriceData> {
  const [EURUSD, GBPUSD, XAUUSD] = await Promise.all([
    finnhubQuote("OANDA:EUR_USD", apiKey),
    finnhubQuote("OANDA:GBP_USD", apiKey),
    finnhubQuote("OANDA:XAU_USD", apiKey),
  ]);
  return { EURUSD, GBPUSD, XAUUSD, source: "finnhub", fetchedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Provider 3: Twelve Data  (8 req/min free — batch)
// ---------------------------------------------------------------------------

async function fromTwelveData(apiKey: string): Promise<PriceData> {
  const symbols = "EUR/USD,GBP/USD,XAU/USD";
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();

  if (data?.status === "error") {
    throw new Error(`Twelve Data: ${data.message ?? "error"}`);
  }

  const pick = (sym: string): Quote => {
    const entry = data?.[sym];
    const priceStr = entry?.close ?? entry?.price;
    if (!priceStr) throw new Error(`Twelve Data: missing ${sym}`);
    const price = parseFloat(priceStr);
    if (!Number.isFinite(price)) throw new Error(`Twelve Data: invalid ${sym}`);
    return {
      price,
      change: entry.change ? parseFloat(entry.change) : undefined,
      changePercent: entry.percent_change ? parseFloat(entry.percent_change) : undefined,
      dayHigh: entry.high ? parseFloat(entry.high) : undefined,
      dayLow: entry.low ? parseFloat(entry.low) : undefined,
    };
  };

  return {
    EURUSD: pick("EUR/USD"),
    GBPUSD: pick("GBP/USD"),
    XAUUSD: pick("XAU/USD"),
    source: "twelvedata",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Provider 4: exchangerate.host  (FX only, flaky gold — emergency fallback)
// ---------------------------------------------------------------------------

async function fromExchangeRateHost(): Promise<PriceData> {
  const url = "https://api.exchangerate.host/latest?base=USD&symbols=EUR,GBP,XAU";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`exchangerate.host HTTP ${res.status}`);
  const data = await res.json();

  const eurPerUsd = data?.rates?.EUR;
  const gbpPerUsd = data?.rates?.GBP;
  const xauPerUsd = data?.rates?.XAU;

  if (!eurPerUsd || !gbpPerUsd || !xauPerUsd) {
    throw new Error("exchangerate.host: missing rates");
  }

  return {
    EURUSD: { price: 1 / eurPerUsd },
    GBPUSD: { price: 1 / gbpPerUsd },
    XAUUSD: { price: 1 / xauPerUsd },
    source: "exchangerate.host",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Provider 5: Alpha Vantage  (25 req/day — last resort)
// ---------------------------------------------------------------------------

async function fetchAVRate(from: string, to: string, apiKey: string): Promise<number> {
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${apiKey}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const data = await res.json();
  if (data["Note"] || data["Information"]) {
    throw new Error(`Alpha Vantage rate-limited`);
  }
  const rate = data?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
  if (!rate) throw new Error(`Alpha Vantage: bad response for ${from}/${to}`);
  return parseFloat(rate);
}

async function fromAlphaVantage(apiKey: string): Promise<PriceData> {
  const [e, g, x] = await Promise.all([
    fetchAVRate("EUR", "USD", apiKey),
    fetchAVRate("GBP", "USD", apiKey),
    fetchAVRate("XAU", "USD", apiKey),
  ]);
  return {
    EURUSD: { price: e },
    GBPUSD: { price: g },
    XAUUSD: { price: x },
    source: "alphavantage",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator — IBR Live → Yahoo → Finnhub → Twelve Data → exchangerate.host → AV
// ---------------------------------------------------------------------------

async function fetchPrices(): Promise<PriceData> {
  const errors: string[] = [];

  // 1. IBR Live (primary for FX; XAUUSD patched from Yahoo)
  const ibrKey = process.env.IBR_LIVE_API_KEY;
  if (ibrKey && ibrKey !== "your_ibr_live_key_here") {
    try { return await fromIbrLive(ibrKey); }
    catch (e) { errors.push(`ibrlive: ${(e as Error).message}`); }
  }

  // 2. Yahoo (free, unlimited, rich)
  try { return await fromYahoo(); }
  catch (e) { errors.push(`yahoo: ${(e as Error).message}`); }

  // 2. Finnhub (60/min free)
  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey && fhKey !== "your_finnhub_key_here") {
    try { return await fromFinnhub(fhKey); }
    catch (e) { errors.push(`finnhub: ${(e as Error).message}`); }
  }

  // 3. Twelve Data (8/min free)
  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey && tdKey !== "your_twelvedata_key_here") {
    try { return await fromTwelveData(tdKey); }
    catch (e) { errors.push(`twelvedata: ${(e as Error).message}`); }
  }

  // 4. exchangerate.host (no key)
  try { return await fromExchangeRateHost(); }
  catch (e) { errors.push(`exchangerate.host: ${(e as Error).message}`); }

  // 5. Alpha Vantage (25/day)
  const avKey = process.env.ALPHAVANTAGE_API_KEY;
  if (avKey && avKey !== "your_alphavantage_key_here") {
    try { return await fromAlphaVantage(avKey); }
    catch (e) { errors.push(`alphavantage: ${(e as Error).message}`); }
  }

  throw new Error(`All price providers failed. ${errors.join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  const now = Date.now();
  if (cachedPrices && now - cacheTimestamp < CACHE_TTL_MS) {
    return NextResponse.json(cachedPrices, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const prices = await fetchPrices();
    cachedPrices = prices;
    cacheTimestamp = now;
    return NextResponse.json(prices, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (cachedPrices) {
      return NextResponse.json(
        { ...cachedPrices, stale: true, warning: message },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
