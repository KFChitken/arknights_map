ALTER TABLE "users" ADD COLUMN "drunk_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "drinks_total" integer DEFAULT 0 NOT NULL;