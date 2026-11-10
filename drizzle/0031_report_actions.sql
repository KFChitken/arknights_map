CREATE TABLE "mod_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"rule" text,
	"yellow" boolean DEFAULT false NOT NULL,
	"until" timestamp with time zone,
	"auto" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"appeal" text,
	"appealed_at" timestamp with time zone,
	"appeal_result" text,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"action_id" uuid,
	"reason" text,
	"rule" text,
	"reported_on" date,
	"until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspended_auto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reports_upheld" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reports_dismissed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "blocks_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD CONSTRAINT "mod_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notes" ADD CONSTRAINT "staff_notes_action_id_mod_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."mod_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_actions_user_idx" ON "mod_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_notes_user_idx" ON "staff_notes" USING btree ("user_id","created_at");