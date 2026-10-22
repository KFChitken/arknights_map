ALTER TABLE "login_codes" ADD COLUMN "day_start" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "login_codes" ADD COLUMN "sent_today" smallint DEFAULT 1 NOT NULL;