CREATE TABLE "pokes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"woke_told_at" timestamp with time zone,
	"woke_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pokes" ADD CONSTRAINT "pokes_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pokes" ADD CONSTRAINT "pokes_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pokes_pair_day_idx" ON "pokes" USING btree ("from_user_id","to_user_id","day");--> statement-breakpoint
CREATE INDEX "pokes_to_idx" ON "pokes" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "pokes_from_idx" ON "pokes" USING btree ("from_user_id","created_at");