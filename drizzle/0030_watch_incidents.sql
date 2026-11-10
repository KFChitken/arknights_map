CREATE TABLE "watch_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"advice" text DEFAULT '' NOT NULL,
	"worst" text,
	"worst_score" double precision,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"times" integer DEFAULT 1 NOT NULL,
	"mailed_at" timestamp with time zone,
	"recovered_mailed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"acked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_mails" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "watch_incidents_key_idx" ON "watch_incidents" USING btree ("key","ended_at");--> statement-breakpoint
CREATE INDEX "watch_incidents_started_idx" ON "watch_incidents" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "watch_mails_at_idx" ON "watch_mails" USING btree ("at");--> statement-breakpoint
-- the problems open when this goes live count as open already, and as told, so none is emailed again
INSERT INTO "watch_incidents" ("key", "level", "title", "detail", "started_at", "last_seen_at", "mailed_at")
SELECT "key", 'quiet', "title", "detail", "since", now(), coalesce("mailed_at", "since") FROM "watch_alerts";
