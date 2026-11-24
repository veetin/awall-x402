CREATE TABLE "usage_rollups" (
	"identity_id" text NOT NULL,
	"route" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"requests" integer NOT NULL,
	"credits" integer NOT NULL,
	"paid_credits" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"applied_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_rollups" ADD CONSTRAINT "usage_rollups_identity_id_identities_id_fk" FOREIGN KEY ("identity_id") REFERENCES "public"."identities"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_rollups_identity_route_hour" ON "usage_rollups" USING btree ("identity_id","route","hour");
