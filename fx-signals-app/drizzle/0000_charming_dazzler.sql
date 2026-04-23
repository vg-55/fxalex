CREATE TABLE "dedupe_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"pair" text PRIMARY KEY NOT NULL,
	"tv_symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"aoi_low" double precision NOT NULL,
	"aoi_high" double precision NOT NULL,
	"ma50" double precision NOT NULL,
	"decimals" integer NOT NULL,
	"sl_buffer_pct" double precision NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"pair" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"price" double precision NOT NULL,
	"change_pct" double precision,
	"day_high" double precision,
	"day_low" double precision,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scanner_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"error" text,
	"signals_count" integer,
	"transitions_count" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scanner_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"active_provider" text,
	"backoff_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signal_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_confidence" integer,
	"to_confidence" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"pair" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"price" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"tp" double precision NOT NULL,
	"rr" double precision NOT NULL,
	"aoi" text NOT NULL,
	"timeframe" text NOT NULL,
	"tv_symbol" text NOT NULL,
	"session" text NOT NULL,
	"trend" text NOT NULL,
	"ai_confidence" integer NOT NULL,
	"factors" jsonb NOT NULL,
	"ai_interpretation" text NOT NULL,
	"change_pct" double precision,
	"day_high" double precision,
	"day_low" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dedupe_expires_idx" ON "dedupe_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "notifications_dedupe_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "price_ticks_pair_time_idx" ON "price_ticks" USING btree ("pair","fetched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scanner_runs_started_idx" ON "scanner_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "signal_history_pair_time_idx" ON "signal_history" USING btree ("pair","created_at" DESC NULLS LAST);