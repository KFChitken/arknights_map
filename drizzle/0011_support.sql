ALTER TABLE "users" ADD COLUMN "support" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "support_changed_at" timestamp with time zone;