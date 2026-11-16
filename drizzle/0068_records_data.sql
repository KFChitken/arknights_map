CREATE TABLE "drinks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"sober_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "visit_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "old_touches_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "old_touches_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "old_declarations" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "old_reactions_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "old_reactions_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drinks" ADD CONSTRAINT "drinks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drinks_user_at_idx" ON "drinks" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "touches_created_brin" ON "touches" USING brin ("created_at") WITH (autosummarize=true);