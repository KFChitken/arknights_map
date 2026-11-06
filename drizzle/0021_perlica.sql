CREATE TABLE "perlica_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'touch' NOT NULL,
	"bold" boolean NOT NULL,
	"reply_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"ignored_at" timestamp with time zone,
	"away_seconds" integer,
	"line" smallint,
	"times" smallint
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perlica_friend_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perlica_timer" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perlica_timer_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "perlica_touches" ADD CONSTRAINT "perlica_touches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perlica_touches_user_idx" ON "perlica_touches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "perlica_touches_reply_idx" ON "perlica_touches" USING btree ("reply_to");