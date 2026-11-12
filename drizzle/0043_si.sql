CREATE TABLE "si_inks" (
	"no" integer PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"look" text NOT NULL,
	"drawn_at" timestamp with time zone NOT NULL,
	"ticket" integer NOT NULL,
	CONSTRAINT "si_inks_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "si_tickets" (
	"n" integer PRIMARY KEY NOT NULL,
	"ink_no" integer NOT NULL,
	"again" boolean NOT NULL,
	"queued_at" timestamp with time zone NOT NULL,
	"checkin_at" timestamp with time zone NOT NULL,
	"said_in" boolean DEFAULT false NOT NULL,
	"said_out" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "si_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"kind" text DEFAULT 'touch' NOT NULL,
	"bold" boolean NOT NULL,
	"reply_to" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"ignored_at" timestamp with time zone,
	"line" smallint,
	"stamp" smallint,
	"stamps" integer,
	"room" smallint,
	"waited" integer
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "si_friend_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "si_portrait_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "si_portrait" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "si_stamps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "si_stamped_on" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "si_stayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "si_inks" ADD CONSTRAINT "si_inks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "si_tickets" ADD CONSTRAINT "si_tickets_ink_no_si_inks_no_fk" FOREIGN KEY ("ink_no") REFERENCES "public"."si_inks"("no") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "si_touches" ADD CONSTRAINT "si_touches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "si_tickets_checkin_idx" ON "si_tickets" USING btree ("checkin_at","n");--> statement-breakpoint
CREATE INDEX "si_tickets_queued_idx" ON "si_tickets" USING btree ("queued_at","n");--> statement-breakpoint
CREATE INDEX "si_tickets_in_idx" ON "si_tickets" USING btree ("checkin_at") WHERE not "si_tickets"."said_in";--> statement-breakpoint
CREATE INDEX "si_tickets_out_idx" ON "si_tickets" USING btree ("checkin_at") WHERE not "si_tickets"."said_out";--> statement-breakpoint
CREATE INDEX "si_touches_user_idx" ON "si_touches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "si_touches_reply_idx" ON "si_touches" USING btree ("reply_to");--> statement-breakpoint
CREATE INDEX "si_touches_today_idx" ON "si_touches" USING btree ("created_at","user_id") WHERE "si_touches"."direction" = 'to_si';