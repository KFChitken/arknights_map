ALTER TABLE "users" ADD COLUMN "radar_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "radar_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fire_nights" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "fire_night_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sneak_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sneak_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birthday_wished" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "quilted_by" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "far_moves" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "drunk_at" timestamp with time zone;