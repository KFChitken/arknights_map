CREATE TABLE "daily_totals" (
	"day" date PRIMARY KEY NOT NULL,
	"active_week" integer NOT NULL,
	"signups" integer NOT NULL,
	"friendships" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"user_id" uuid NOT NULL,
	"badge" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"serial" smallint,
	"seen_at" timestamp with time zone,
	CONSTRAINT "user_badges_user_id_badge_pk" PRIMARY KEY("user_id","badge")
);
--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "line" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_on" date;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;