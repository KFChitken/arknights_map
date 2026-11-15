ALTER TABLE "declarations" ADD COLUMN "room_id" uuid;--> statement-breakpoint
ALTER TABLE "declarations" ADD COLUMN "song" text;--> statement-breakpoint
ALTER TABLE "listen_rooms" ADD COLUMN "declared_at" timestamp with time zone;--> statement-breakpoint
-- Every declaration there is has no room: NOT VALID leaves them unread (the table is large); new ones are checked all the
-- same, and a room deleted still sets theirs null
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_room_id_listen_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."listen_rooms"("id") ON DELETE set null ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE INDEX "declarations_room_idx" ON "declarations" USING btree ("room_id") WHERE "declarations"."room_id" is not null;