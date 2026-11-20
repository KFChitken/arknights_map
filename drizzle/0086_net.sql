CREATE TABLE "fish_nets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"since" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fish_nets" ADD CONSTRAINT "fish_nets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;