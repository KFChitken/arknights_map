CREATE TABLE "mail_sends" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
