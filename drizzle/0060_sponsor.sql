CREATE TABLE "sponsor_months" (
	"month" text PRIMARY KEY NOT NULL,
	"spent_fen" integer NOT NULL,
	"received_fen" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_months_month" CHECK ("sponsor_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "sponsor_months_sums" CHECK ("sponsor_months"."spent_fen" >= 0 and "sponsor_months"."received_fen" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sponsor_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"afdian" text DEFAULT '' NOT NULL,
	"kofi" text DEFAULT '' NOT NULL,
	"startup_fen" integer DEFAULT 0 NOT NULL,
	"startup_note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_settings_one_row" CHECK ("sponsor_settings"."id" = 1),
	CONSTRAINT "sponsor_settings_startup" CHECK ("sponsor_settings"."startup_fen" >= 0)
);
