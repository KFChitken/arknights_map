ALTER TABLE "users" ADD COLUMN "study_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "studied_on" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "study_course" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "study_course_on" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "study_bag" text[] DEFAULT '{}'::text[] NOT NULL;