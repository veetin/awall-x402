CREATE TABLE "console_users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "console_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "console_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "console_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "console_sessions" ADD CONSTRAINT "console_sessions_user_id_console_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."console_users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "console_sessions_user_id_idx" ON "console_sessions" USING btree ("user_id","created_at" DESC NULLS LAST);
