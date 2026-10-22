CREATE TABLE "declaration_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"declaration_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "food" text;--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "declaration_reactions" ADD CONSTRAINT "declaration_reactions_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_reactions" ADD CONSTRAINT "declaration_reactions_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_once_idx" ON "declaration_reactions" USING btree ("declaration_id","from_user_id");