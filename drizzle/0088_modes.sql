ALTER TABLE "squad_members" ADD COLUMN "mode_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "mode_combo" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "mode_tap_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_members" ADD COLUMN "mode_again_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode" text;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode_by" smallint;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode_song" text;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode_song_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "squad_rooms" ADD COLUMN "mode_last" timestamp with time zone;