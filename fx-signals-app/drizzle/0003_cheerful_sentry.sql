ALTER TABLE "scanner_state" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "signal_outcomes" ADD COLUMN "lot_size" double precision;