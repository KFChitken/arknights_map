CREATE TABLE "off_limits_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"radius_m" integer NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved" integer DEFAULT 0 NOT NULL,
	"sent_home" integer DEFAULT 0 NOT NULL,
	"moved_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	CONSTRAINT "off_limits_areas_radius_check" CHECK ("off_limits_areas"."radius_m" between 30 and 3000),
	CONSTRAINT "off_limits_areas_label_check" CHECK (char_length("off_limits_areas"."label") between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "off_limits_areas" ADD CONSTRAINT "off_limits_areas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "off_limits_areas" ADD CONSTRAINT "off_limits_areas_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;