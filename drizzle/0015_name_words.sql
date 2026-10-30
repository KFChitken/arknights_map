CREATE TABLE "name_words" (
	"word" text PRIMARY KEY NOT NULL,
	"whole" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
