CREATE TABLE "credit_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"delta_credits" bigint NOT NULL,
	"reason" text NOT NULL,
	"payment_id" text,
	"usage_event_id" bigint,
	"balance_after" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"api_key_hash" text,
	"wallet" text,
	"fingerprint" text,
	"abuse_score" real DEFAULT 0 NOT NULL,
	"credit_balance" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"pack_credits" integer NOT NULL,
	"price_usdc_atomic" text NOT NULL,
	"price_brl_cents" integer NOT NULL,
	"multiplier" real DEFAULT 1 NOT NULL,
	"network" text NOT NULL,
	"asset" text NOT NULL,
	"pay_to" text NOT NULL,
	"rails" text[] NOT NULL,
	"pix_charge_id" text,
	"pix_br_code" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"rail" text NOT NULL,
	"amount" text NOT NULL,
	"asset" text NOT NULL,
	"network" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"tx_hash" text,
	"payer" text,
	"settle_response" jsonb,
	"status" text NOT NULL,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"identity_id" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"credits" integer NOT NULL,
	"decision" text NOT NULL,
	"origin_status" integer,
	"latency_ms" integer,
	"request_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_identity_id_idx" ON "credit_ledger" USING btree ("identity_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "identities_api_key_hash_key" ON "identities" USING btree ("api_key_hash") WHERE "identities"."api_key_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_wallet_key" ON "identities" USING btree ("wallet") WHERE "identities"."wallet" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_fingerprint_key" ON "identities" USING btree ("fingerprint") WHERE "identities"."fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "usage_events_identity_created_idx" ON "usage_events" USING btree ("identity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_events_created_idx" ON "usage_events" USING btree ("created_at" DESC NULLS LAST);