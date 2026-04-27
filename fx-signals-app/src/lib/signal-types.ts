// Shared frontend types for signals (mirror of /api/signals + /api/stream payload).

export type SignalStatus = "ACTIVE" | "PENDING" | "WATCHING";
export type Session = "Asia" | "London" | "NY" | "London/NY Overlap" | "Off-hours";

export type Pair =
  | "XAUUSD"
  | "EURUSD"
  | "GBPUSD"
  | "GBPNZD"
  | "EURJPY"
  | "CADJPY"
  | "AUDCAD"
  | "GBPAUD"
  | "EURAUD"
  | "USDCAD"
  | "USDCHF"
  | "NZDCAD"
  | "GBPCHF";

// Pairs that use 2 decimal places (JPY crosses + gold)
export const TWO_DECIMAL_PAIRS: Pair[] = ["XAUUSD", "EURJPY", "CADJPY"];

export function pairDecimals(pair: string): number {
  return TWO_DECIMAL_PAIRS.includes(pair as Pair) ? 2 : 4;
}

export type NewsEvent = {
  id: string;
  title: string;
  country: string;
  scheduledAt: string;
  minutesUntil: number;
};

export type Signal = {
  id: string;
  pair: Pair;
  type: "BUY" | "SELL";
  price: string;
  sl: string;
  tp: string;
  rr: string;
  timestamp: string;
  status: SignalStatus;
  aoi: string;
  timeframe: string;
  tvSymbol: string;
  session: Session;
  trend: "Bullish" | "Bearish";
  weeklyBias: "Bullish" | "Bearish" | "Ranging";
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  aiInterpretation: string;
  aiConfidence: number;
  factors: {
    proximity: number;
    emaConfluence: number;
    weeklyTrend: number;
    rejection: number;
    momentum: number;
    sessionQuality: number;
    rrQuality: number;
    aiBoost: number;
    /** weeklyBias stored inside factors JSONB to avoid DB migration */
    weeklyBias?: "Bullish" | "Bearish" | "Ranging";
  };
  liveEma50?: number;
  dailyEma50?: number;
  trendAligned: boolean;
  atr?: number;
  rejectionConfirmed: boolean;
  newsBlocked: boolean;
  nextEvent?: NewsEvent | null;
  isStale: boolean;
  /** ISO time when status first became ACTIVE (frozen on the row) */
  enteredAt?: string;
  /** True when the row carries a frozen entry/SL/TP snapshot. */
  locked: boolean;
};

// DB row shape used by the SSE stream (price/sl/tp are numbers here)
export type StreamSignalRow = {
  pair: Pair;
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
  factors: Signal["factors"];
  aiInterpretation: string;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  liveEma50: number | null;
  dailyEma50: number | null;
  trendAligned: boolean;
  atr: number | null;
  rejectionConfirmed: boolean;
  newsBlocked: boolean;
  nextEvent: NewsEvent | null;
  isStale: boolean;
  updatedAt: string;
};

export function rowToSignal(row: StreamSignalRow): Signal {
  const decimals = pairDecimals(row.pair);
  const factors = row.factors;
  // weeklyBias is stored inside factors.weeklyBias (no DB migration needed)
  const weeklyBias: "Bullish" | "Bearish" | "Ranging" = factors?.weeklyBias ?? "Ranging";
  // _locked snapshot is stamped on first ACTIVE and preserved across scans.
  const lock = (factors as { _locked?: { at: string; entry: number; sl: number; tp: number; type: "BUY" | "SELL" } } | null)?._locked;
  return {
    id: `${row.pair}:${row.type}`,
    pair: row.pair,
    type: row.type,
    status: row.status,
    price: row.price.toFixed(decimals),
    sl: row.sl.toFixed(decimals),
    tp: row.tp.toFixed(decimals),
    rr: `1:${row.rr.toFixed(1)}`,
    timestamp: row.updatedAt,
    aoi: row.aoi,
    timeframe: row.timeframe,
    tvSymbol: row.tvSymbol,
    session: row.session,
    trend: row.trend,
    weeklyBias,
    changePercent: row.changePct ?? undefined,
    dayHigh: row.dayHigh ?? undefined,
    dayLow: row.dayLow ?? undefined,
    aiInterpretation: row.aiInterpretation,
    aiConfidence: row.aiConfidence,
    factors,
    liveEma50: row.liveEma50 ?? undefined,
    dailyEma50: row.dailyEma50 ?? undefined,
    trendAligned: row.trendAligned,
    atr: row.atr ?? undefined,
    rejectionConfirmed: row.rejectionConfirmed,
    newsBlocked: row.newsBlocked,
    nextEvent: row.nextEvent ?? null,
    isStale: row.isStale,
    enteredAt: lock?.at,
    locked: !!lock,
  };
}
