ALTER TABLE "price_ticks" ADD COLUMN "secondary_source" text;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD COLUMN "secondary_price" double precision;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD COLUMN "deviation_pct" double precision;--> statement-breakpoint
ALTER TABLE "price_ticks" ADD COLUMN "is_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "live_ema50" double precision;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "is_stale" boolean DEFAULT false NOT NULL;