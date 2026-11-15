CREATE TABLE "listen_now" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"song" text NOT NULL,
	"room_id" uuid,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "song_plays" (
	"song" text PRIMARY KEY NOT NULL,
	"plays" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" text PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"name" text NOT NULL,
	"album_id" text NOT NULL,
	"album" text NOT NULL,
	"artists" text[] DEFAULT '{}'::text[] NOT NULL,
	"seconds" real NOT NULL,
	"file" text NOT NULL,
	"bytes" integer NOT NULL,
	"album_order" integer NOT NULL,
	"track" smallint NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	"gone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "listen_now" ADD CONSTRAINT "listen_now_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listen_now_until_idx" ON "listen_now" USING btree ("until");--> statement-breakpoint
CREATE INDEX "songs_order_idx" ON "songs" USING btree ("album_order","track");