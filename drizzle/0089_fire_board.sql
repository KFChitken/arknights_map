CREATE TABLE "squad_fire_rooms" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"week" timestamp with time zone NOT NULL,
	"peak" smallint DEFAULT 0 NOT NULL,
	"peak_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "squad_fire_sticks" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"week" timestamp with time zone NOT NULL,
	"sticks" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_fire_sticks_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "squad_fire_weeks" (
	"week" timestamp with time zone PRIMARY KEY NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"board" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_prog" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_top" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_last_top" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_best_top" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "squad_fire_hide" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_fire_sticks" ADD CONSTRAINT "squad_fire_sticks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_fire_rooms_week_idx" ON "squad_fire_rooms" USING btree ("week","peak");--> statement-breakpoint
CREATE INDEX "squad_fire_sticks_week_idx" ON "squad_fire_sticks" USING btree ("week");