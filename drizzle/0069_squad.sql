CREATE TABLE "squad_members" (
	"room_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" smallint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"kicked" boolean DEFAULT false NOT NULL,
	"in_game" boolean DEFAULT false NOT NULL,
	"core" smallint DEFAULT 0 NOT NULL,
	"strategy" smallint,
	"extras" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	CONSTRAINT "squad_members_room_id_user_id_pk" PRIMARY KEY("room_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "squad_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"server" text NOT NULL,
	"level" smallint NOT NULL,
	"tags" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"key" text NOT NULL,
	"key_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key_changes" smallint DEFAULT 0 NOT NULL,
	"friends_only" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'wait' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"waited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"went_at" timestamp with time zone,
	"state_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "squad_core" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "squad_strategy" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "squad_extras" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_room_id_squad_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."squad_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_members" ADD CONSTRAINT "squad_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD CONSTRAINT "squad_rooms_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "squad_members_one_room" ON "squad_members" USING btree ("user_id") WHERE "squad_members"."left_at" is null;--> statement-breakpoint
CREATE INDEX "squad_members_user_idx" ON "squad_members" USING btree ("user_id","joined_at");--> statement-breakpoint
CREATE INDEX "squad_rooms_open_idx" ON "squad_rooms" USING btree ("created_at") WHERE "squad_rooms"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "squad_rooms_host_idx" ON "squad_rooms" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "squad_rooms_ended_idx" ON "squad_rooms" USING btree ("ended_at");