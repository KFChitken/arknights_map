CREATE TABLE "song_favourites" (
	"user_id" uuid NOT NULL,
	"song" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "song_favourites_user_id_song_pk" PRIMARY KEY("user_id","song")
);
--> statement-breakpoint
CREATE TABLE "song_heard" (
	"day" date NOT NULL,
	"song" text NOT NULL,
	"n" bigint NOT NULL,
	CONSTRAINT "song_heard_day_song_pk" PRIMARY KEY("day","song")
);
--> statement-breakpoint
ALTER TABLE "listen_now" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "listen_now" ADD COLUMN "heard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "song_favourites" ADD CONSTRAINT "song_favourites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;