CREATE TABLE "online_hours" (
	"day" date NOT NULL,
	"hour" smallint NOT NULL,
	"peak" integer NOT NULL,
	"peak_at" timestamp with time zone NOT NULL,
	CONSTRAINT "online_hours_day_hour_pk" PRIMARY KEY("day","hour")
);
--> statement-breakpoint
CREATE TABLE "online_now" (
	"process" text PRIMARY KEY NOT NULL,
	"n" integer NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stat_counts" (
	"day" date NOT NULL,
	"name" text NOT NULL,
	"n" bigint NOT NULL,
	CONSTRAINT "stat_counts_day_name_pk" PRIMARY KEY("day","name")
);
--> statement-breakpoint
CREATE TABLE "stat_snapshots" (
	"day" date PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_totals" ADD COLUMN "players" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_totals" ADD COLUMN "visitors" integer DEFAULT 0 NOT NULL;