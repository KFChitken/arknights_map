ALTER TABLE "banned_emails" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "cleared_values" ADD COLUMN "action_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_actions" ADD COLUMN "roach_slot" smallint;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "roach_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "place_lng" double precision;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "place_lat" double precision;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "roach_slot" smallint;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "near_m" integer;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_roach_id_roaches_id_fk" FOREIGN KEY ("roach_id") REFERENCES "public"."roaches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_actions_appeal_idx" ON "mod_actions" USING btree ("appealed_at");--> statement-breakpoint
CREATE INDEX "reports_roach_idx" ON "reports" USING btree ("roach_id");