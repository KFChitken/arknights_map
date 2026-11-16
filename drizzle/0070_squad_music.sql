CREATE TABLE "squad_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"handle" smallint NOT NULL,
	"song" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "queue" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "idx" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_requests" ADD CONSTRAINT "squad_requests_room_id_squad_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."squad_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_requests_room_idx" ON "squad_requests" USING btree ("room_id","created_at");