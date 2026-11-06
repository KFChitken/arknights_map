CREATE TABLE "minghe_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'touch' NOT NULL,
	"bold" boolean NOT NULL,
	"reply_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"ignored_at" timestamp with time zone,
	"stop" smallint,
	"times" smallint
);
--> statement-breakpoint
ALTER TABLE "roaches" ADD COLUMN "ride_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roaches" ADD COLUMN "ride_start_day" integer;--> statement-breakpoint
ALTER TABLE "roaches" ADD COLUMN "ride_day" integer;--> statement-breakpoint
ALTER TABLE "roaches" ADD COLUMN "ride_from_lng" double precision;--> statement-breakpoint
ALTER TABLE "roaches" ADD COLUMN "ride_from_lat" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "minghe_friend_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "minghe_touches" ADD CONSTRAINT "minghe_touches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "minghe_touches_user_idx" ON "minghe_touches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "minghe_touches_reply_idx" ON "minghe_touches" USING btree ("reply_to");--> statement-breakpoint
CREATE INDEX "roaches_ride_idx" ON "roaches" USING btree ("ride_since") WHERE "roaches"."ride_since" is not null;