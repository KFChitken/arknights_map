CREATE TABLE "squad_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"answer" text,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "squad_room_id" uuid;--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "squad_call" text;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_invites" ADD CONSTRAINT "squad_invites_room_id_squad_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."squad_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_invites" ADD CONSTRAINT "squad_invites_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_invites" ADD CONSTRAINT "squad_invites_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_invites_to_idx" ON "squad_invites" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "squad_invites_pair_idx" ON "squad_invites" USING btree ("from_user_id","to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "squad_invites_room_idx" ON "squad_invites" USING btree ("room_id");--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_squad_room_id_squad_rooms_id_fk" FOREIGN KEY ("squad_room_id") REFERENCES "public"."squad_rooms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "declarations_squad_room_idx" ON "declarations" USING btree ("squad_room_id") WHERE "declarations"."squad_room_id" is not null;