CREATE TABLE "cleared_values" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cleared_values_user_id_kind_value_pk" PRIMARY KEY("user_id","kind","value")
);
--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "held_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "held_anonymous" boolean;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "held_share_uid" boolean;--> statement-breakpoint
ALTER TABLE "cleared_values" ADD CONSTRAINT "cleared_values_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;