CREATE TABLE "song_reactions" (
	"song" text NOT NULL,
	"phrase" smallint NOT NULL,
	"n" bigint NOT NULL,
	CONSTRAINT "song_reactions_song_phrase_pk" PRIMARY KEY("song","phrase")
);
--> statement-breakpoint
ALTER TABLE "friend_notes" ADD COLUMN "song" text;--> statement-breakpoint
ALTER TABLE "listen_invites" ADD COLUMN "asked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_listening" boolean DEFAULT true NOT NULL;