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
  source: "yahoo" | "finnhub" | "twelvedata" | "alphavantage";
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

async function fromYahoo(): Promise<PriceBundle> {
  const fetchSymbol = async (sym: string): Promise<Quote> => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: 5000,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
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
  };

  const [EURUSD, GBPUSD, XAUUSD] = await Promise.all([
    fetchSymbol("EURUSD=X"),
    fetchSymbol("GBPUSD=X"),
    fetchSymbol("XAUUSD=X"),
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

  // Try Yahoo first but abandon after 5 s — Vercel IPs are frequently blocked
  // by Yahoo, causing 20+ second hangs before a connection error is thrown.
  // The AbortController timeout inside fromYahoo already limits individual
  // symbol fetches to 5 s; this outer try-catch captures that quickly.
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
