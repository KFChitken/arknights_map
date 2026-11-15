CREATE TABLE "listen_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"answer" text,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "listen_members" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" smallint NOT NULL,
	"via" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"away_at" timestamp with time zone,
	"kicked" boolean DEFAULT false NOT NULL,
	"hidden_from" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	CONSTRAINT "listen_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "listen_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"idx" smallint DEFAULT 0 NOT NULL,
	"queue" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
ALTER TABLE "listen_invites" ADD CONSTRAINT "listen_invites_room_id_listen_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."listen_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_invites" ADD CONSTRAINT "listen_invites_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_invites" ADD CONSTRAINT "listen_invites_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_members" ADD CONSTRAINT "listen_members_room_id_listen_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."listen_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_members" ADD CONSTRAINT "listen_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_rooms" ADD CONSTRAINT "listen_rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listen_invites_to_idx" ON "listen_invites" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "listen_invites_pair_idx" ON "listen_invites" USING btree ("from_user_id","to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "listen_invites_room_idx" ON "listen_invites" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listen_members_one_room" ON "listen_members" USING btree ("user_id") WHERE "listen_members"."left_at" is null;--> statement-breakpoint
CREATE INDEX "listen_rooms_open_idx" ON "listen_rooms" USING btree ("created_at") WHERE "listen_rooms"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "listen_rooms_ended_idx" ON "listen_rooms" USING btree ("ended_at");--> statement-breakpoint
ALTER TABLE "listen_now" ADD CONSTRAINT "listen_now_room_id_listen_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."listen_rooms"("id") ON DELETE set null ON UPDATE no action;