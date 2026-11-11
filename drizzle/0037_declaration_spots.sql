CREATE TABLE "declaration_spots" (
	"declaration_id" uuid NOT NULL,
	"spot" smallint NOT NULL,
	"cell" integer NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"sender_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "declaration_spots_declaration_id_spot_pk" PRIMARY KEY("declaration_id","spot")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "declarations_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "declaration_spots" ADD CONSTRAINT "declaration_spots_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "declaration_spots_cell_idx" ON "declaration_spots" USING btree ("cell","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "declaration_spots_created_idx" ON "declaration_spots" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "declarations_created_idx" ON "declarations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reactions_from_idx" ON "declaration_reactions" USING btree ("from_user_id","created_at");