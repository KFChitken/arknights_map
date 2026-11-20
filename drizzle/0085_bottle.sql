CREATE TABLE "fish_bottles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"caught_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"pass_id" bigint,
	"note_say" smallint,
	"note_km" integer,
	"thrown" smallint
);
--> statement-breakpoint
CREATE TABLE "fish_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"from_id" uuid NOT NULL,
	"say" smallint NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fish_bottles" ADD CONSTRAINT "fish_bottles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fish_notes" ADD CONSTRAINT "fish_notes_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fish_bottles_user_idx" ON "fish_bottles" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "fish_notes_at_idx" ON "fish_notes" USING btree ("at");