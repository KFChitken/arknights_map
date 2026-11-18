CREATE TABLE "listen_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"handle" smallint NOT NULL,
	"song" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listen_rooms" ADD COLUMN "queue_by" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "listen_requests" ADD CONSTRAINT "listen_requests_room_id_listen_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."listen_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listen_requests_room_idx" ON "listen_requests" USING btree ("room_id","created_at");