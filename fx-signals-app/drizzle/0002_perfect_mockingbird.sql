CREATE TABLE "account_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"equity" double precision DEFAULT 10000 NOT NULL,
	"risk_per_trade_pct" double precision DEFAULT 1 NOT NULL,
	"max_concurrent" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_events" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"country" text NOT NULL,
	"impact" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair" text NOT NULL,
	"type" text NOT NULL,
	"entry" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"tp" double precision NOT NULL,
	"result" text NOT NULL,
	"r_pnl" double precision NOT NULL,
	"entered_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hold_minutes" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "daily_ema50" double precision;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "trend_aligned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "atr" double precision;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "rejection_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "news_blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "next_event" jsonb;--> statement-breakpoint
CREATE INDEX "news_events_scheduled_idx" ON "news_events" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "signal_outcomes_pair_idx" ON "signal_outcomes" USING btree ("pair","closed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signal_outcomes_closed_idx" ON "signal_outcomes" USING btree ("closed_at" DESC NULLS LAST);