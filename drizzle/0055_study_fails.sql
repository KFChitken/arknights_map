ALTER TABLE "users" ADD COLUMN "study_fails" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "study_skipped_on" text;