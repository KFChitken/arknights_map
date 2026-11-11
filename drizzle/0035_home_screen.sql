CREATE TABLE "app_counts" (
	"day" date NOT NULL,
	"name" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "app_counts_day_name_pk" PRIMARY KEY("day","name")
);
--> statement-breakpoint
CREATE TABLE "desk_codes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "desk_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "desk_codes" ADD CONSTRAINT "desk_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;