import {
  pgTable,
  text,
  integer,
  doublePrecision,
  jsonb,
  timestamp,
  boolean,
  serial,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// instruments — per-pair Set & Forget configuration (moved out of code)
// ---------------------------------------------------------------------------
export const instruments = pgTable("instruments", {
  pair: text("pair").primaryKey(),
  tvSymbol: text("tv_symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  aoiLow: doublePrecision("aoi_low").notNull(),
  aoiHigh: doublePrecision("aoi_high").notNull(),
  ma50: doublePrecision("ma50").notNull(),
  decimals: integer("decimals").notNull(),
  slBufferPct: doublePrecision("sl_buffer_pct").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// price_ticks — raw price samples
// ---------------------------------------------------------------------------
export const priceTicks = pgTable(
  "price_ticks",
  {
    id: serial("id").primaryKey(),
    pair: text("pair").notNull(),
    price: doublePrecision("price").notNull(),
    changePct: doublePrecision("change_pct"),
    dayHigh: doublePrecision("day_high"),
    dayLow: doublePrecision("day_low"),
    source: text("source").notNull(),
    secondarySource: text("secondary_source"),
    secondaryPrice: doublePrecision("secondary_price"),
    deviationPct: doublePrecision("deviation_pct"),
    isStale: boolean("is_stale").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPairTime: index("price_ticks_pair_time_idx").on(t.pair, t.fetchedAt.desc()),
  })
);

// ---------------------------------------------------------------------------
// signals — current state per pair
// ---------------------------------------------------------------------------
export const signals = pgTable("signals", {
  pair: text("pair").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  price: doublePrecision("price").notNull(),
  sl: doublePrecision("sl").notNull(),
  tp: doublePrecision("tp").notNull(),
  rr: doublePrecision("rr").notNull(),
  aoi: text("aoi").notNull(),
  timeframe: text("timeframe").notNull(),
  tvSymbol: text("tv_symbol").notNull(),
  session: text("session").notNull(),
  trend: text("trend").notNull(),
  aiConfidence: integer("ai_confidence").notNull(),
  factors: jsonb("factors").notNull(),
  aiInterpretation: text("ai_interpretation").notNull(),
  changePct: doublePrecision("change_pct"),
  dayHigh: doublePrecision("day_high"),
  dayLow: doublePrecision("day_low"),
  liveEma50: doublePrecision("live_ema50"),
  dailyEma50: doublePrecision("daily_ema50"),
  trendAligned: boolean("trend_aligned").notNull().default(false),
  atr: doublePrecision("atr"),
  rejectionConfirmed: boolean("rejection_confirmed").notNull().default(false),
  newsBlocked: boolean("news_blocked").notNull().default(false),
  nextEvent: jsonb("next_event"),
  isStale: boolean("is_stale").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// signal_history — transitions audit log
// ---------------------------------------------------------------------------
export const signalHistory = pgTable(
  "signal_history",
  {
    id: serial("id").primaryKey(),
    pair: text("pair").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    fromConfidence: integer("from_confidence"),
    toConfidence: integer("to_confidence").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPairTime: index("signal_history_pair_time_idx").on(t.pair, t.createdAt.desc()),
  })
);

// ---------------------------------------------------------------------------
// notifications — in-app notification inbox
// ---------------------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    pair: text("pair"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCreated: index("notifications_created_idx").on(t.createdAt.desc()),
    byUnread: index("notifications_unread_idx").on(t.readAt),
    byDedupe: index("notifications_dedupe_idx").on(t.dedupeKey),
  })
);

// ---------------------------------------------------------------------------
// dedupe_keys — cooldown tracker
// ---------------------------------------------------------------------------
export const dedupeKeys = pgTable(
  "dedupe_keys",
  {
    key: text("key").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    byExpires: index("dedupe_expires_idx").on(t.expiresAt),
  })
);

// ---------------------------------------------------------------------------
// scanner_runs — observability
// ---------------------------------------------------------------------------
export const scannerRuns = pgTable(
  "scanner_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    provider: text("provider"),
    ok: boolean("ok").notNull(),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    signalsCount: integer("signals_count"),
    transitionsCount: integer("transitions_count"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    byStarted: index("scanner_runs_started_idx").on(t.startedAt.desc()),
  })
);

// ---------------------------------------------------------------------------
// scanner_state — singleton
// ---------------------------------------------------------------------------
export const scannerState = pgTable("scanner_state", {
  id: integer("id").primaryKey().default(1),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  activeProvider: text("active_provider"),
  backoffUntil: timestamp("backoff_until", { withTimezone: true }),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// account_settings — singleton, position sizing input
// ---------------------------------------------------------------------------
export const accountSettings = pgTable("account_settings", {
  id: integer("id").primaryKey().default(1),
  equity: doublePrecision("equity").notNull().default(10000),
  riskPerTradePct: doublePrecision("risk_per_trade_pct").notNull().default(1),
  maxConcurrent: integer("max_concurrent").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// news_events — cached high-impact calendar events
// ---------------------------------------------------------------------------
export const newsEvents = pgTable(
  "news_events",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    country: text("country").notNull(),
    impact: text("impact").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byScheduled: index("news_events_scheduled_idx").on(t.scheduledAt),
  })
);

// ---------------------------------------------------------------------------
// signal_outcomes — closed-trade ledger for performance tracking
// ---------------------------------------------------------------------------
export const signalOutcomes = pgTable(
  "signal_outcomes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    pair: text("pair").notNull(),
    type: text("type").notNull(),
    entry: doublePrecision("entry").notNull(),
    sl: doublePrecision("sl").notNull(),
    tp: doublePrecision("tp").notNull(),
    result: text("result").notNull(),
    rPnl: doublePrecision("r_pnl").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    holdMinutes: integer("hold_minutes").notNull(),
  },
  (t) => ({
    byPair: index("signal_outcomes_pair_idx").on(t.pair, t.closedAt.desc()),
    byClosed: index("signal_outcomes_closed_idx").on(t.closedAt.desc()),
  })
);

export type Instrument = typeof instruments.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type AccountSettingsRow = typeof accountSettings.$inferSelect;
export type NewsEventRow = typeof newsEvents.$inferSelect;
export type SignalOutcomeRow = typeof signalOutcomes.$inferSelect;
