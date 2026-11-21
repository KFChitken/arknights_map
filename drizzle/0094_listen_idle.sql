ALTER TABLE "listen_members" ADD COLUMN "did_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listen_members" ADD COLUMN "lapsed" boolean DEFAULT false NOT NULL;