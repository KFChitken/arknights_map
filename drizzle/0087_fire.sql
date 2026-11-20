ALTER TABLE "squad_members" ADD COLUMN "wood" smallint DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "wood_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "head" smallint;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "head_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "fx" smallint;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "fx_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "ball" smallint;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "ball_from" smallint;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "ball_n" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "ball_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_level" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_by" smallint;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_burn" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_best" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "fire_last" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "squad_no_throw" boolean DEFAULT false NOT NULL;