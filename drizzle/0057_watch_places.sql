ALTER TABLE "off_limits_areas" ADD COLUMN "watch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "watch_area_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_watch_area_id_off_limits_areas_id_fk" FOREIGN KEY ("watch_area_id") REFERENCES "public"."off_limits_areas"("id") ON DELETE set null ON UPDATE no action;