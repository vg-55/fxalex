// Live price provider cascade — pulled out of the API route so the cron
// scanner and any future workers can reuse it.

export type Quote = {
  price: number;
  bid?: number;
  ask?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
};

export type PriceBundle = {
  EURUSD: Quote;
  GBPUSD: Quote;
  XAUUSD: Quote;
  source: "ibrlive+yahoo" | "yahoo" | "finnhub" | "twelvedata" | "alphavantage";
  fetchedAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps fetch with an AbortController timeout. Throws on timeout or HTTP error. */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 8000, ...rest } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

// --- IBR Live --------------------------------------------------------------
// https://api.ibrlive.com/api  — covers FX only (no XAUUSD). We fetch the
// snapshot for EURUSD/GBPUSD, previous-close for change%, and patch XAUUSD
// in from Yahoo's chart endpoint.

const IBR_BASE = "https://api.ibrlive.com/api";

type IbrSnapshotQuote = { s: string; a: number; b: number; t: number };
type IbrSnapshotResponse = { success: boolean; lastQuotes?: IbrSnapshotQuote[] };
type IbrPrevClose = { open: number; high: number; low: number; close: number };
type IbrPrevCloseResponse = { success: boolean; data?: IbrPrevClose };

async function ibrGet<T>(path: string, apiKey: string, timeoutMs = 6000): Promise<T> {
  const res = await fetchWithTimeout(`${IBR_BASE}${path}`, {
    timeoutMs,
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

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

/** Fetches a single Yahoo symbol via the v8 chart endpoint (matches fromYahoo).
 *  Tries query1 first; on 429 or network error falls over to query2. */
async function yahooChartQuote(sym: string): Promise<Quote> {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    Accept: "application/json,text/plain,*/*",
  };
  const errors: string[] = [];
  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${sym}?interval=1m&range=1d`;
    try {
      const res = await fetchWithTimeout(url, { timeoutMs: 5000, cache: "no-store", headers });
      if (res.status === 429) {
        errors.push(`${host}: 429`);
        continue; // try next host
      }
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${sym}`);
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== "number") {
        throw new Error(`Yahoo invalid meta for ${sym}`);
      }
      const price = meta.regularMarketPrice;
      const prev = meta.previousClose || price;
      const change = price - prev;
      const changePercent = prev ? (change / prev) * 100 : undefined;
      return {
        price,
        change,
        changePercent,
        dayHigh: meta.regularMarketDayHigh,
        dayLow: meta.regularMarketDayLow,
      };
    } catch (e) {
      errors.push(`${host}: ${(e as Error).message}`);
    }
  }
  throw new Error(`Yahoo ${sym} unavailable: ${errors.join(" | ")}`);
}

function ibrBuildQuote(tick: IbrSnapshotQuote, prev: IbrPrevClose | null): Quote {
  const price = (tick.a + tick.b) / 2;
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

  try { return await yahooChartQuote("GC=F"); }
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
      const res = await fetchWithTimeout(url, { timeoutMs: 8000, cache: "no-store" });
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

async function fromIbrLive(apiKey: string): Promise<PriceBundle> {
  const [snapshot, prevEUR, prevGBP, xauResult] = await Promise.all([
    ibrGet<IbrSnapshotResponse>("/forex/snapshot", apiKey),
    ibrGet<IbrPrevCloseResponse>("/forex/previous-close?symbol=EURUSD", apiKey).catch(
      () => null as IbrPrevCloseResponse | null
    ),
    ibrGet<IbrPrevCloseResponse>("/forex/previous-close?symbol=GBPUSD", apiKey).catch(
      () => null as IbrPrevCloseResponse | null
    ),
    // XAUUSD is optional — a gold-only failure must NOT kill the EUR/GBP feed.
    fetchXauusdViaCascade().catch((e: unknown) => {
      console.warn("[prices:ibrlive] XAUUSD cascade failed:", (e as Error).message);
      return null as Quote | null;
    }),
  ]);

  const quotes: IbrSnapshotQuote[] = snapshot.lastQuotes ?? [];
  const eurTick = quotes.find((q) => q.s === "EURUSD");
  const gbpTick = quotes.find((q) => q.s === "GBPUSD");
  if (!eurTick) throw new Error("IBR Live: missing EURUSD in snapshot");
  if (!gbpTick) throw new Error("IBR Live: missing GBPUSD in snapshot");

  // If all gold providers failed, use a sentinel that marks XAUUSD as unavailable.
  // The scanner will receive isStale=true for XAUUSD via cross-validation and
  // will demote any XAUUSD signal to PENDING rather than crashing entirely.
  const xau: Quote = xauResult ?? { price: 0 };

  return {
    EURUSD: ibrBuildQuote(eurTick, prevEUR?.data ?? null),
    GBPUSD: ibrBuildQuote(gbpTick, prevGBP?.data ?? null),
    XAUUSD: xau,
    source: "ibrlive+yahoo",
    fetchedAt: new Date().toISOString(),
  };
}

// --- Yahoo -----------------------------------------------------------------

async function fromYahoo(): Promise<PriceBundle> {
  const [EURUSD, GBPUSD, XAUUSD] = await Promise.all([
    yahooChartQuote("EURUSD=X"),
    yahooChartQuote("GBPUSD=X"),
    // `XAUUSD=X` is delisted on Yahoo (404). `GC=F` is COMEX front-month gold
    // futures and is the working spot-gold proxy on Yahoo Finance.
    yahooChartQuote("GC=F"),
  ]);

  return {
    EURUSD,
    GBPUSD,
    XAUUSD,
    source: "yahoo",
    fetchedAt: new Date().toISOString(),
  };
}

async function finnhubQuote(symbol: string, apiKey: string): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 6000, cache: "no-store" });
  if (!res.ok) throw new Error(`Finnhub HTTP ${res.status} for ${symbol}`);
  const d = await res.json();
  const price = Number(d?.c);
  if (!Number.isFinite(price) || price === 0) throw new Error(`Finnhub invalid ${symbol}`);
  return {
    price,
    change: typeof d.d === "number" ? d.d : undefined,
    changePercent: typeof d.dp === "number" ? d.dp : undefined,
    dayHigh: typeof d.h === "number" ? d.h : undefined,
    dayLow: typeof d.l === "number" ? d.l : undefined,
  };
}

async function fromFinnhub(apiKey: string): Promise<PriceBundle> {
  const [EURUSD, GBPUSD, XAUUSD] = await Promise.all([
    finnhubQuote("OANDA:EUR_USD", apiKey),
    finnhubQuote("OANDA:GBP_USD", apiKey),
    finnhubQuote("OANDA:XAU_USD", apiKey),
  ]);
  return { EURUSD, GBPUSD, XAUUSD, source: "finnhub", fetchedAt: new Date().toISOString() };
}

async function fromTwelveData(apiKey: string): Promise<PriceBundle> {
  const symbols = "EUR/USD,GBP/USD,XAU/USD";
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${apiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 8000, cache: "no-store" });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();
  if (data?.status === "error") throw new Error(`Twelve Data: ${data.message ?? "error"}`);
  const pick = (sym: string): Quote => {
    const e = data?.[sym];
    const p = e?.close ?? e?.price;
    if (!p) throw new Error(`TD: missing ${sym}`);
    const price = parseFloat(p);
    if (!Number.isFinite(price)) throw new Error(`TD: invalid ${sym}`);
    return {
      price,
      change: e.change ? parseFloat(e.change) : undefined,
      changePercent: e.percent_change ? parseFloat(e.percent_change) : undefined,
      dayHigh: e.high ? parseFloat(e.high) : undefined,
      dayLow: e.low ? parseFloat(e.low) : undefined,
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

async function fetchAVRate(from: string, to: string, apiKey: string): Promise<number> {
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${from}&to_currency=${to}&apikey=${apiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 8000, cache: "no-store" });
  if (!res.ok) throw new Error(`AV HTTP ${res.status}`);
  const data = await res.json();
  if (data["Note"] || data["Information"]) throw new Error("AV rate-limited");
  const rate = data?.["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
  if (!rate) throw new Error(`AV bad response ${from}/${to}`);
  return parseFloat(rate);
}

async function fromAlphaVantage(apiKey: string): Promise<PriceBundle> {
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
// Orchestrator
// ---------------------------------------------------------------------------

export async function fetchLivePrices(): Promise<PriceBundle> {
  const errors: string[] = [];

  // 1. IBR Live — primary for FX (EURUSD/GBPUSD); XAUUSD patched in from Yahoo.
  const ibrKey = process.env.IBR_LIVE_API_KEY;
  if (ibrKey && ibrKey !== "your_ibr_live_key_here") {
    try { return await fromIbrLive(ibrKey); }
    catch (e) { errors.push(`ibrlive: ${(e as Error).message}`); }
  }

  // 2. Yahoo — full fallback (unlimited, no key).
  // Individual symbol fetches are already bounded to 5 s via fetchWithTimeout.
  try { return await fromYahoo(); }
  catch (e) { errors.push(`yahoo: ${(e as Error).message}`); }

  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey && fhKey !== "your_finnhub_key_here") {
    try { return await fromFinnhub(fhKey); }
    catch (e) { errors.push(`finnhub: ${(e as Error).message}`); }
  }

  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey && tdKey !== "your_twelvedata_key_here") {
    try { return await fromTwelveData(tdKey); }
    catch (e) { errors.push(`twelvedata: ${(e as Error).message}`); }
  }

  const avKey = process.env.ALPHAVANTAGE_API_KEY;
  if (avKey && avKey !== "your_alphavantage_key_here") {
    try { return await fromAlphaVantage(avKey); }
    catch (e) { errors.push(`alphavantage: ${(e as Error).message}`); }
  }

  throw new Error(`All price providers failed. ${errors.join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Cross-validated fetcher — races two providers and flags suspicious ticks
// ---------------------------------------------------------------------------

export type ValidatedQuote = Quote & {
  secondarySource?: PriceBundle["source"];
  secondaryPrice?: number;
  deviationPct?: number;
  isStale: boolean;
};

export type ValidatedBundle = {
  EURUSD: ValidatedQuote;
  GBPUSD: ValidatedQuote;
  XAUUSD: ValidatedQuote;
  primary: PriceBundle["source"];
  secondary: PriceBundle["source"] | null;
  anyStale: boolean;
  fetchedAt: string;
};

function computeDeviation(a: number, b: number): number {
  const mid = (a + b) / 2;
  if (mid === 0) return 0;
  return (Math.abs(a - b) / mid) * 100;
}

async function fetchSecondary(): Promise<PriceBundle | null> {
  // Prefer Yahoo as the secondary — it's free, covers all three pairs, and is
  // the most independent from IBR Live (different data path entirely).
  try { return await fromYahoo(); } catch { /* fall through */ }

  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey && fhKey !== "your_finnhub_key_here") {
    try { return await fromFinnhub(fhKey); } catch { /* fall through */ }
  }
  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey && tdKey !== "your_twelvedata_key_here") {
    try { return await fromTwelveData(tdKey); } catch { /* fall through */ }
  }
  return null;
}

export async function fetchLivePricesValidated(): Promise<ValidatedBundle> {
  const threshold = Number(process.env.PRICE_DEVIATION_MAX_PCT ?? 0.15);

  // Primary must succeed; otherwise fail entirely using the full cascade.
  const [primaryResult, secondaryResult] = await Promise.allSettled([
    fetchLivePrices(),
    fetchSecondary(),
  ]);

  if (primaryResult.status !== "fulfilled") {
    throw primaryResult.reason instanceof Error
      ? primaryResult.reason
      : new Error("primary price feed failed");
  }
  const primary = primaryResult.value;
  const secondary =
    secondaryResult.status === "fulfilled" && secondaryResult.value && secondaryResult.value.source !== primary.source
      ? secondaryResult.value
      : null;

  const pairs: Array<"EURUSD" | "GBPUSD" | "XAUUSD"> = ["EURUSD", "GBPUSD", "XAUUSD"];
  const out: Partial<ValidatedBundle> = {
    primary: primary.source,
    secondary: secondary?.source ?? null,
    anyStale: false,
    fetchedAt: new Date().toISOString(),
  };
  let anyStale = false;
  for (const p of pairs) {
    const a = primary[p];
    const b = secondary?.[p];
    let vq: ValidatedQuote = { ...a, isStale: false };
    if (b) {
      const deviationPct = computeDeviation(a.price, b.price);
      const isStale = deviationPct > threshold;
      vq = {
        ...a,
        secondarySource: secondary!.source,
        secondaryPrice: b.price,
        deviationPct,
        isStale,
      };
      if (isStale) anyStale = true;
    }
    (out as ValidatedBundle)[p] = vq;
  }
  (out as ValidatedBundle).anyStale = anyStale;
  return out as ValidatedBundle;
}
