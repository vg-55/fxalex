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
    lotSize: doublePrecision("lot_size"),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    holdMinutes: integer("hold_minutes").notNull(),
  },
  (t) => ({
    byPair: index("signal_outcomes_pair_idx").on(t.pair, t.closedAt.desc()),
    byClosed: index("signal_outcomes_closed_idx").on(t.closedAt.desc()),
  })
);

// ---------------------------------------------------------------------------
// mt5_accounts — broker accounts the trader has connected for live execution
// (credentials are AES-GCM encrypted at rest; provisioned via MetaApi.cloud)
// ---------------------------------------------------------------------------
export const mt5Accounts = pgTable("mt5_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  broker: text("broker"),
  server: text("server").notNull(),
  login: text("login").notNull(),
  passwordEnc: text("password_enc").notNull(),
  // MetaApi provisioning
  metaapiAccountId: text("metaapi_account_id"),
  metaapiRegion: text("metaapi_region").notNull().default("new-york"),
  metaapiState: text("metaapi_state"), // UNDEPLOYED | DEPLOYING | DEPLOYED | UNDEPLOYING | …
  // mode + filters
  mode: text("mode").notNull().default("OFF"), // OFF | SHADOW | LIVE
  strategies: jsonb("strategies").notNull().default(sql`'["COMBINED"]'::jsonb`), // string[]
  symbols: jsonb("symbols"), // null = all, else string[]
  // risk config
  riskPctPerTrade: doublePrecision("risk_pct_per_trade").notNull().default(0.5),
  maxConcurrent: integer("max_concurrent").notNull().default(3),
  maxDailyLossPct: doublePrecision("max_daily_loss_pct").notNull().default(3),
  maxLot: doublePrecision("max_lot").notNull().default(1),
  minRR: doublePrecision("min_rr").notNull().default(1.5),
  // live snapshot (refreshed by poller)
  balance: doublePrecision("balance"),
  equity: doublePrecision("equity"),
  margin: doublePrecision("margin"),
  marginLevel: doublePrecision("margin_level"),
  currency: text("currency"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mt5_orders — every order request the router emits (audit + reconciliation)
// ---------------------------------------------------------------------------
export const mt5Orders = pgTable(
  "mt5_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    accountId: uuid("account_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    signalPair: text("signal_pair").notNull(),
    signalSource: text("signal_source").notNull(), // ALEX | FABIO | COMBINED
    signalType: text("signal_type").notNull(),     // BUY | SELL
    status: text("status").notNull(),              // PENDING | OPEN | CLOSED | REJECTED | ERRORED | SHADOW
    ticket: text("ticket"),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    requestedLot: doublePrecision("requested_lot").notNull(),
    filledLot: doublePrecision("filled_lot"),
    entry: doublePrecision("entry").notNull(),
    sl: doublePrecision("sl").notNull(),
    tp: doublePrecision("tp").notNull(),
    closePrice: doublePrecision("close_price"),
    pnl: doublePrecision("pnl"),
    commission: doublePrecision("commission"),
    swap: doublePrecision("swap"),
    rejectionReason: text("rejection_reason"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAccount: index("mt5_orders_account_idx").on(t.accountId, t.createdAt.desc()),
    byIdempotency: index("mt5_orders_idempotency_idx").on(t.idempotencyKey),
  })
);

// ---------------------------------------------------------------------------
// mt5_audit — append-only operational log for the live-trading pipeline
// ---------------------------------------------------------------------------
export const mt5Audit = pgTable(
  "mt5_audit",
  {
    id: serial("id").primaryKey(),
    accountId: uuid("account_id"),
    level: text("level").notNull(), // info | warn | error
    event: text("event").notNull(),
    detail: jsonb("detail"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAccount: index("mt5_audit_account_idx").on(t.accountId, t.at.desc()),
  })
);

// ---------------------------------------------------------------------------
// ctrader_accounts — Spotware Open API connections (OAuth-based, no broker pwd)
// ---------------------------------------------------------------------------
export const ctraderAccounts = pgTable("ctrader_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  // Spotware identifiers
  ctidTraderAccountId: text("ctid_trader_account_id").notNull(), // numeric, e.g. "10000372"
  traderLogin: text("trader_login"),                              // human login
  brokerName: text("broker_name"),                                // e.g. "IC Markets Raw Spread"
  isLive: boolean("is_live").notNull().default(false),
  // OAuth tokens (encrypted via AES-GCM, same key as MT5)
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
  scope: text("scope"),
  // Mode + filters (mirrors mt5_accounts)
  mode: text("mode").notNull().default("OFF"), // OFF | SHADOW | LIVE
  strategies: jsonb("strategies").notNull().default(sql`'["COMBINED"]'::jsonb`),
  symbols: jsonb("symbols"),
  riskPctPerTrade: doublePrecision("risk_pct_per_trade").notNull().default(0.5),
  maxConcurrent: integer("max_concurrent").notNull().default(3),
  maxDailyLossPct: doublePrecision("max_daily_loss_pct").notNull().default(3),
  maxLot: doublePrecision("max_lot").notNull().default(1),
  minRR: doublePrecision("min_rr").notNull().default(1.5),
  // Live snapshot
  balance: doublePrecision("balance"),
  equity: doublePrecision("equity"),
  margin: doublePrecision("margin"),
  marginLevel: doublePrecision("margin_level"),
  currency: text("currency"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// bridge_accounts — self-hosted bots (cTrader cBot or MT5 EA on a Windows VPS)
// authenticate to us with a Bearer token. Polymorphic via the `provider`
// column so both cTrader Desktop's cBot and MT5's EA share one wire protocol.
// We never store the broker password here — the bot lives inside an already-
// signed-in cTrader Desktop / MT5 instance and trades through the platform's
// internal API. This bypasses Spotware Open API approval AND MetaApi billing.
// ---------------------------------------------------------------------------
export const bridgeAccounts = pgTable(
  "bridge_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    label: text("label").notNull(),
    provider: text("provider").notNull(), // 'ctrader' | 'mt5'
    // sha256 of the bearer token shown to the user once at creation. One-way:
    // we never need to display or reverse it. Compared via timingSafeEqual.
    bearerTokenHash: text("bearer_token_hash").notNull().unique(),
    accountLogin: text("account_login"),
    brokerName: text("broker_name"),
    currency: text("currency"),
    // Operating mode + filters (mirror mt5_accounts shape).
    mode: text("mode").notNull().default("OFF"), // OFF | SHADOW | LIVE
    strategies: jsonb("strategies").notNull().default(sql`'["COMBINED"]'::jsonb`),
    symbols: jsonb("symbols"),
    // Per-account symbol remap (e.g. {"XAUUSD": "GOLD"} for IC RAW MT5).
    symbolOverrides: jsonb("symbol_overrides"),
    riskPctPerTrade: doublePrecision("risk_pct_per_trade").notNull().default(0.5),
    maxConcurrent: integer("max_concurrent").notNull().default(3),
    maxDailyLossPct: doublePrecision("max_daily_loss_pct").notNull().default(3),
    maxLot: doublePrecision("max_lot").notNull().default(1),
    minRR: doublePrecision("min_rr").notNull().default(1.5),
    // Heartbeat-fed snapshot.
    balance: doublePrecision("balance"),
    equity: doublePrecision("equity"),
    marginLevel: doublePrecision("margin_level"),
    openPositions: integer("open_positions"),
    botVersion: text("bot_version"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastError: text("last_error"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashIdx: index("bridge_accounts_token_hash_idx").on(t.bearerTokenHash),
  })
);

// ---------------------------------------------------------------------------
// bridge_orders — append-only ledger of orders queued for self-hosted bots.
// State machine: QUEUED → SENT (claimed atomically by /poll) → FILLED |
// REJECTED. CLOSED later when the position closes (heartbeat or ack).
// ---------------------------------------------------------------------------
export const bridgeOrders = pgTable(
  "bridge_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    accountId: uuid("account_id")
      .notNull()
      .references(() => bridgeAccounts.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id"), // not FK — signals.id may be uuid or external
    signalSource: text("signal_source"), // ALEX | FABIO | COMBINED (provenance)
    status: text("status").notNull().default("QUEUED"),
    // QUEUED | SENT | FILLED | REJECTED | CLOSED | CANCELLED
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // BUY | SELL
    requestedLot: doublePrecision("requested_lot").notNull(),
    entry: doublePrecision("entry").notNull(),
    sl: doublePrecision("sl").notNull(),
    tp: doublePrecision("tp").notNull(),
    filledLot: doublePrecision("filled_lot"),
    fillPrice: doublePrecision("fill_price"),
    pnl: doublePrecision("pnl"),
    rejectionReason: text("rejection_reason"),
    brokerPositionId: text("broker_position_id"),
    brokerOrderId: text("broker_order_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    accountStatusIdx: index("bridge_orders_account_status_idx").on(t.accountId, t.status),
    createdAtIdx: index("bridge_orders_created_at_idx").on(t.createdAt),
  })
);

export type Instrument = typeof instruments.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type AccountSettingsRow = typeof accountSettings.$inferSelect;
export type NewsEventRow = typeof newsEvents.$inferSelect;
export type SignalOutcomeRow = typeof signalOutcomes.$inferSelect;
export type Mt5AccountRow = typeof mt5Accounts.$inferSelect;
export type Mt5OrderRow = typeof mt5Orders.$inferSelect;
export type Mt5AuditRow = typeof mt5Audit.$inferSelect;
export type CtraderAccountRow = typeof ctraderAccounts.$inferSelect;
export type BridgeAccountRow = typeof bridgeAccounts.$inferSelect;
export type BridgeOrderRow = typeof bridgeOrders.$inferSelect;