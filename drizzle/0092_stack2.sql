CREATE TABLE "squad_stack_blocks" (
	"room_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"week" timestamp with time zone NOT NULL,
	"blocks" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "squad_stack_blocks_room_id_round_user_id_pk" PRIMARY KEY("room_id","round","user_id")
);
--> statement-breakpoint
CREATE TABLE "squad_stack_towers" (
	"room_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"week" timestamp with time zone NOT NULL,
	"peak" integer DEFAULT 0 NOT NULL,
	"peak_at" timestamp with time zone,
	CONSTRAINT "squad_stack_towers_room_id_round_pk" PRIMARY KEY("room_id","round")
);
--> statement-breakpoint
CREATE TABLE "squad_stack_weeks" (
	"week" timestamp with time zone PRIMARY KEY NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"board" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "squad_rooms" ALTER COLUMN "stack_best" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "stack" jsonb;--> statement-breakpoint
ALTER TABLE "squad_stack_blocks" ADD CONSTRAINT "squad_stack_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "squad_stack_blocks_week_idx" ON "squad_stack_blocks" USING btree ("week");--> statement-breakpoint
CREATE INDEX "squad_stack_towers_week_idx" ON "squad_stack_towers" USING btree ("week","peak");