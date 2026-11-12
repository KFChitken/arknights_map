CREATE TABLE "admin_backup_codes" (
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_backup_codes_user_id_code_hash_pk" PRIMARY KEY("user_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_alias" text NOT NULL,
	"kind" text NOT NULL,
	"what" text NOT NULL,
	"target_id" uuid,
	"action_id" uuid,
	"detail" text,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"by_user_id" uuid,
	"by_alias" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"alias" text NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pledged_at" timestamp with time zone,
	"totp_secret" text,
	"totp_pending" text,
	"totp_confirmed_at" timestamp with time zone,
	"totp_last_step" bigint,
	"fails" integer DEFAULT 0 NOT NULL,
	"paused_until" timestamp with time zone,
	"pauses" integer DEFAULT 0 NOT NULL,
	"pause_reason" text
);
--> statement-breakpoint
ALTER TABLE "mod_actions" ADD COLUMN "by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD COLUMN "by_alias" text;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "admin_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "admin_fresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_backup_codes" ADD CONSTRAINT "admin_backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_log" ADD CONSTRAINT "admin_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_log" ADD CONSTRAINT "admin_log_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" ADD CONSTRAINT "admins_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_log_at_idx" ON "admin_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "admin_log_actor_idx" ON "admin_log" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "admin_log_target_idx" ON "admin_log" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "admin_notes_user_idx" ON "admin_notes" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "mod_actions" ADD CONSTRAINT "mod_actions_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_actions_by_idx" ON "mod_actions" USING btree ("by_user_id");