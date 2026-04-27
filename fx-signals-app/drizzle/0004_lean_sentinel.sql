CREATE TABLE "mt5_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"broker" text,
	"server" text NOT NULL,
	"login" text NOT NULL,
	"password_enc" text NOT NULL,
	"metaapi_account_id" text,
	"metaapi_region" text DEFAULT 'new-york' NOT NULL,
	"metaapi_state" text,
	"mode" text DEFAULT 'OFF' NOT NULL,
	"strategies" jsonb DEFAULT '["COMBINED"]'::jsonb NOT NULL,
	"symbols" jsonb,
	"risk_pct_per_trade" double precision DEFAULT 0.5 NOT NULL,
	"max_concurrent" integer DEFAULT 3 NOT NULL,
	"max_daily_loss_pct" double precision DEFAULT 3 NOT NULL,
	"max_lot" double precision DEFAULT 1 NOT NULL,
	"min_rr" double precision DEFAULT 1.5 NOT NULL,
	"balance" double precision,
	"equity" double precision,
	"margin" double precision,
	"margin_level" double precision,
	"currency" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mt5_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" uuid,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mt5_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"signal_pair" text NOT NULL,
	"signal_source" text NOT NULL,
	"signal_type" text NOT NULL,
	"status" text NOT NULL,
	"ticket" text,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"requested_lot" double precision NOT NULL,
	"filled_lot" double precision,
	"entry" double precision NOT NULL,
	"sl" double precision NOT NULL,
	"tp" double precision NOT NULL,
	"close_price" double precision,
	"pnl" double precision,
	"commission" double precision,
	"swap" double precision,
	"rejection_reason" text,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mt5_audit_account_idx" ON "mt5_audit" USING btree ("account_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mt5_orders_account_idx" ON "mt5_orders" USING btree ("account_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mt5_orders_idempotency_idx" ON "mt5_orders" USING btree ("idempotency_key");