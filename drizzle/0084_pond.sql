ALTER TABLE "squad_members" ADD COLUMN "fish_n" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "school_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "schools" smallint DEFAULT 0 NOT NULL;