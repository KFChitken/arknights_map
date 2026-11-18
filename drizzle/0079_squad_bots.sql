CREATE TABLE "squad_bots" (
	"room_id" uuid NOT NULL,
	"handle" smallint NOT NULL,
	"no" smallint NOT NULL,
	"avatar" text NOT NULL,
	"color" text NOT NULL,
	"in_game" boolean DEFAULT true NOT NULL,
	"core" smallint DEFAULT 0 NOT NULL,
	"strategy" smallint,
	"extras" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"pose" smallint DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	CONSTRAINT "squad_bots_room_id_handle_pk" PRIMARY KEY("room_id","handle")
);
--> statement-breakpoint
ALTER TABLE "squad_bots" ADD CONSTRAINT "squad_bots_room_id_squad_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."squad_rooms"("id") ON DELETE cascade ON UPDATE no action;