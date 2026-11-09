CREATE TABLE "watch_alerts" (
	"key" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"mailed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "watch_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
