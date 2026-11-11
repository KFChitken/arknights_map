CREATE TABLE "user_passwords" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"set_at" timestamp with time zone NOT NULL,
	"fails" smallint DEFAULT 0 NOT NULL,
	"paused_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_passwords" ADD CONSTRAINT "user_passwords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;