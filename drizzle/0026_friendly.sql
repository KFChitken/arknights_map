CREATE TABLE "friend_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"game" text,
	"asleep" boolean DEFAULT false NOT NULL,
	"reply_to" uuid,
	"answer" text,
	"answered_at" timestamp with time zone,
	"answer_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "visit_bans" (
	"host_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_bans_host_id_guest_id_pk" PRIMARY KEY("host_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"roach_id" uuid PRIMARY KEY NOT NULL,
	"guest_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"host_roach_id" uuid NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"from_lng" double precision,
	"from_lat" double precision,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "declaration_deliveries" ADD COLUMN "to_friend" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "anniversary_seen_a" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "anniversary_seen_b" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcome_guests" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "visit_tip_shown" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "friend_notes" ADD CONSTRAINT "friend_notes_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_notes" ADD CONSTRAINT "friend_notes_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_bans" ADD CONSTRAINT "visit_bans_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_bans" ADD CONSTRAINT "visit_bans_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_roach_id_roaches_id_fk" FOREIGN KEY ("roach_id") REFERENCES "public"."roaches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friend_notes_once_idx" ON "friend_notes" USING btree ("from_user_id","to_user_id","kind","period");--> statement-breakpoint
CREATE INDEX "friend_notes_to_idx" ON "friend_notes" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "friend_notes_from_idx" ON "friend_notes" USING btree ("from_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_guest_host_idx" ON "visits" USING btree ("guest_id","host_id");--> statement-breakpoint
CREATE INDEX "visits_host_idx" ON "visits" USING btree ("host_id");--> statement-breakpoint
CREATE INDEX "visits_host_roach_idx" ON "visits" USING btree ("host_roach_id");