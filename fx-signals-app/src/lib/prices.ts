// Live price provider cascade — supports all 13 watchlist pairs.

export type Quote = {
  price: number;
  bid?: number;
  ask?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
};

export type ProviderSource =
  | "ibrlive+yahoo"
  | "yahoo"
  | "finnhub"
  | "twelvedata"
  | "alphavantage";

export type PriceBundle = {
  quotes: Record<string, Quote>;
  source: ProviderSource;
  fetchedAt: string;
};

// Yahoo symbol override map — pairs that don't follow the `PAIR=X` convention
const YAHOO_SYMBOL_OVERRIDE: Record<string, string> = {
  XAUUSD: "GC=F", // XAUUSD=X is delisted; GC=F is COMEX gold futures
};

function pairToYahooSymbol(pair: string): string {
  return YAHOO_SYMBOL_OVERRIDE[pair] ?? `${pair}=X`;
}

// IBR Live snapshot covers these FX pairs only (no gold)
const IBR_LIVE_PAIRS = new Set([
  "EURUSD", "GBPUSD", "GBPNZD", "EURJPY", "CADJPY",
  "AUDCAD", "GBPAUD", "EURAUD", "USDCAD", "USDCHF", "NZDCAD", "GBPCHF", "USDJPY", "AUDUSD"
]);

// IBR Live only has previous close / historical data for a limited subset
const IBR_HISTORICAL_PAIRS = new Set(["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Yahoo
// ---------------------------------------------------------------------------

const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*",
};

async function yahooChartQuote(sym: string): Promise<Quote> {
  const errors: string[] = [];
  for (const host of YAHOO_HOSTS) {
    const url = `https://${host}/v8/finance/chart/${sym}?interval=1m&range=1d`;
    try {
      const res = await fetchWithTimeout(url, {
        timeoutMs: 5000,
        cache: "no-store",
        headers: YAHOO_HEADERS,
      });
      if (res.status === 429) { errors.push(`${host}: 429`); continue; }
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${sym}`);
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== "number")
        throw new Error(`Yahoo invalid meta for ${sym}`);
      const price = meta.regularMarketPrice;
      const prev = meta.previousClose || price;
      const change = price - prev;
      return {
        price,
        change,
        changePercent: prev ? (change / prev) * 100 : undefined,
        dayHigh: meta.regularMarketDayHigh,
        dayLow: meta.regularMarketDayLow,
      };
    } catch (e) { errors.push(`${host}: ${(e as Error).message}`); }
  }
  throw new Error(`Yahoo ${sym} unavailable: ${errors.join(" | ")}`);
}

async function fromYahoo(pairs: string[]): Promise<PriceBundle> {
  const results = await Promise.all(pairs.map((p) => yahooChartQuote(pairToYahooSymbol(p))));
  const quotes: Record<string, Quote> = {};
  for (let i = 0; i < pairs.length; i++) quotes[pairs[i]] = results[i];
  return { quotes, source: "yahoo", fetchedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// IBR Live
// ---------------------------------------------------------------------------

const IBR_BASE = "https://api.ibrlive.com/api";

type IbrSnapshotQuote = { s: string; a: number; b: number; t: number };
type IbrSnapshotResponse = { success: boolean; lastQuotes?: IbrSnapshotQuote[] };
type IbrPrevClose = { open: number; high: number; low: number; close: number };
type IbrPrevCloseResponse = { success: boolean; data?: IbrPrevClose };

async function ibrGet<T>(path: string, apiKey: string, timeoutMs = 6000): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${IBR_BASE}${path}${separator}apiKey=${apiKey}`;
  const res = await fetchWithTimeout(url, {
    timeoutMs, cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`IBR Live HTTP ${res.status} for ${path}`);
  const data = (await res.json()) as T & { success?: boolean };
  if (data && "success" in data && data.success === false)
    throw new Error(`IBR Live error for ${path}`);
  return data;
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
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent("XAU/USD")}&apikey=${tdKey}`;
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
    try { return { price: await fetchAVRate("XAU", "USD", avKey) }; }
    catch (e) { errors.push(`alphavantage: ${(e as Error).message}`); }
  }
  throw new Error(`XAUUSD unavailable: ${errors.join(" | ")}`);
}

async function fromIbrLive(apiKey: string, pairs: string[]): Promise<PriceBundle> {
  const ibrPairs = pairs.filter((p) => IBR_LIVE_PAIRS.has(p));
  const needsGold = pairs.includes("XAUUSD");

  const [snapshot, ...rest] = await Promise.all([
    ibrGet<IbrSnapshotResponse>("/forex/snapshot", apiKey),
    ...ibrPairs.map((p) =>
      IBR_HISTORICAL_PAIRS.has(p)
        ? ibrGet<IbrPrevCloseResponse>(`/forex/previous-close?symbol=${p}`, apiKey).catch(
            () => null as IbrPrevCloseResponse | null
          )
        : Promise.resolve(null)
    ),
    needsGold
      ? fetchXauusdViaCascade().catch((e: unknown) => {
          console.warn("[prices:ibrlive] XAUUSD cascade failed:", (e as Error).message);
          return null as Quote | null;
        })
      : Promise.resolve(null as null),
  ]);

  const prevCloses = rest.slice(0, ibrPairs.length) as (IbrPrevCloseResponse | null)[];
  const xauResult = needsGold ? (rest[ibrPairs.length] as Quote | null) : null;

  const allQuotes: IbrSnapshotQuote[] = snapshot.lastQuotes ?? [];
  const quotes: Record<string, Quote> = {};

  for (let i = 0; i < ibrPairs.length; i++) {
    const pair = ibrPairs[i];
    const tick = allQuotes.find((q) => q.s === pair);
    if (!tick) throw new Error(`IBR Live: missing ${pair} in snapshot`);
    quotes[pair] = ibrBuildQuote(tick, prevCloses[i]?.data ?? null);
  }

  if (needsGold) {
    // Sentinel price 0 if gold cascade failed — cross-validation will mark isStale
    quotes["XAUUSD"] = xauResult ?? { price: 0 };
  }

  return { quotes, source: "ibrlive+yahoo", fetchedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Finnhub
// ---------------------------------------------------------------------------

const FINNHUB_SYMBOL: Record<string, string> = {
  EURUSD: "OANDA:EUR_USD", GBPUSD: "OANDA:GBP_USD", XAUUSD: "OANDA:XAU_USD",
  GBPNZD: "OANDA:GBP_NZD", EURJPY: "OANDA:EUR_JPY", CADJPY: "OANDA:CAD_JPY",
  AUDCAD: "OANDA:AUD_CAD", GBPAUD: "OANDA:GBP_AUD", EURAUD: "OANDA:EUR_AUD",
  USDCAD: "OANDA:USD_CAD", USDCHF: "OANDA:USD_CHF", NZDCAD: "OANDA:NZD_CAD",
  GBPCHF: "OANDA:GBP_CHF", USDJPY: "OANDA:USD_JPY", AUDUSD: "OANDA:AUD_USD",
};

async function finnhubQuote(symbol: string, apiKey: string): Promise<Quote> {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 6000, cache: "no-store" });
  if (res.status === 403 || res.status === 429) throw new Error(`Finnhub Rate Limit/Auth for ${symbol}`);
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

async function fromFinnhub(apiKey: string, pairs: string[]): Promise<PriceBundle> {
  const results = await Promise.all(
    pairs.map((p) => {
      const sym = FINNHUB_SYMBOL[p];
      if (!sym) throw new Error(`Finnhub: no symbol for ${p}`);
      return finnhubQuote(sym, apiKey);
    })
  );
  const quotes: Record<string, Quote> = {};
  for (let i = 0; i < pairs.length; i++) quotes[pairs[i]] = results[i];
  return { quotes, source: "finnhub", fetchedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// TwelveData
// ---------------------------------------------------------------------------

const TD_SYMBOL: Record<string, string> = {
  EURUSD: "EUR/USD", GBPUSD: "GBP/USD", XAUUSD: "XAU/USD",
  GBPNZD: "GBP/NZD", EURJPY: "EUR/JPY", CADJPY: "CAD/JPY",
  AUDCAD: "AUD/CAD", GBPAUD: "GBP/AUD", EURAUD: "EUR/AUD",
  USDCAD: "USD/CAD", USDCHF: "USD/CHF", NZDCAD: "NZD/CAD",
  GBPCHF: "GBP/CHF",
};

async function fromTwelveData(apiKey: string, pairs: string[]): Promise<PriceBundle> {
  const symbols = pairs.map((p) => TD_SYMBOL[p] ?? p).join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${apiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 8000, cache: "no-store" });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const data = await res.json();
  if (data?.status === "error") throw new Error(`Twelve Data: ${data.message ?? "error"}`);
  const quotes: Record<string, Quote> = {};
  for (const pair of pairs) {
    const sym = TD_SYMBOL[pair] ?? pair;
    const e = data?.[sym];
    const p = e?.close ?? e?.price;
    if (!p) throw new Error(`TD: missing ${sym}`);
    const price = parseFloat(p);
    if (!Number.isFinite(price)) throw new Error(`TD: invalid ${sym}`);
    quotes[pair] = {
      price,
      change: e.change ? parseFloat(e.change) : undefined,
      changePercent: e.percent_change ? parseFloat(e.percent_change) : undefined,
      dayHigh: e.high ? parseFloat(e.high) : undefined,
      dayLow: e.low ? parseFloat(e.low) : undefined,
    };
  }
  return { quotes, source: "twelvedata", fetchedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// AlphaVantage
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function fetchLivePrices(pairs?: string[]): Promise<PriceBundle> {
  const requestedPairs = pairs ?? ["EURUSD", "GBPUSD", "XAUUSD"];
  const errors: string[] = [];

  const ibrKey = process.env.IBR_LIVE_API_KEY;
  if (ibrKey && ibrKey !== "your_ibr_live_key_here") {
    try { return await fromIbrLive(ibrKey, requestedPairs); }
    catch (e) { errors.push(`ibrlive: ${(e as Error).message}`); }
  }

  try { return await fromYahoo(requestedPairs); }
  catch (e) { errors.push(`yahoo: ${(e as Error).message}`); }

  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey && fhKey !== "your_finnhub_key_here") {
    try { return await fromFinnhub(fhKey, requestedPairs); }
    catch (e) { errors.push(`finnhub: ${(e as Error).message}`); }
  }

  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey && tdKey !== "your_twelvedata_key_here") {
    try { return await fromTwelveData(tdKey, requestedPairs); }
    catch (e) { errors.push(`twelvedata: ${(e as Error).message}`); }
  }

  throw new Error(`All price providers failed. ${errors.join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Cross-validated fetcher
// ---------------------------------------------------------------------------

export type ValidatedQuote = Quote & {
  secondarySource?: ProviderSource;
  secondaryPrice?: number;
  deviationPct?: number;
  isStale: boolean;
};

export type ValidatedBundle = {
  quotes: Record<string, ValidatedQuote>;
  primary: ProviderSource;
  secondary: ProviderSource | null;
  anyStale: boolean;
  fetchedAt: string;
};

function computeDeviation(a: number, b: number): number {
  const mid = (a + b) / 2;
  if (mid === 0) return 0;
  return (Math.abs(a - b) / mid) * 100;
}

async function fetchSecondary(pairs: string[], skipSource?: ProviderSource): Promise<PriceBundle | null> {
  if (skipSource !== "yahoo") {
    try { return await fromYahoo(pairs); } catch { /* fall through */ }
  }
  
  const fhKey = process.env.FINNHUB_API_KEY;
  if (fhKey && fhKey !== "your_finnhub_key_here" && skipSource !== "finnhub") {
    try { return await fromFinnhub(fhKey, pairs); } catch { /* fall through */ }
  }
  
  const tdKey = process.env.TWELVEDATA_API_KEY;
  if (tdKey && tdKey !== "your_twelvedata_key_here" && skipSource !== "twelvedata") {
    try { return await fromTwelveData(tdKey, pairs); } catch { /* fall through */ }
  }
  return null;
}

export async function fetchLivePricesValidated(pairs?: string[]): Promise<ValidatedBundle> {
  const requestedPairs = pairs ?? ["EURUSD", "GBPUSD", "XAUUSD"];
  const threshold = Number(process.env.PRICE_DEVIATION_MAX_PCT ?? 0.15);

  let primary: PriceBundle;
  try {
    primary = await fetchLivePrices(requestedPairs);
  } catch (err) {
    throw err instanceof Error ? err : new Error("primary price feed failed");
  }

  const secondaryResult = await fetchSecondary(
    requestedPairs, 
    primary.source === "ibrlive+yahoo" ? "yahoo" : primary.source
  ).catch(() => null);

  const secondary = secondaryResult && secondaryResult.source !== primary.source ? secondaryResult : null;

  const validatedQuotes: Record<string, ValidatedQuote> = {};
  let anyStale = false;

  for (const p of requestedPairs) {
    const a = primary.quotes[p];
    if (!a) continue;
    const b = secondary?.quotes[p];
    if (b) {
      const deviationPct = computeDeviation(a.price, b.price);
      const isStale = deviationPct > threshold;
      validatedQuotes[p] = { ...a, secondarySource: secondary!.source, secondaryPrice: b.price, deviationPct, isStale };
      if (isStale) anyStale = true;
    } else {
      validatedQuotes[p] = { ...a, isStale: false };
    }
  }

  return {
    quotes: validatedQuotes,
    primary: primary.source,
    secondary: secondary?.source ?? null,
    anyStale,
    fetchedAt: new Date().toISOString(),
  };
}
