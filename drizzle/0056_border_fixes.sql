CREATE TABLE "border_fixes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run" text NOT NULL,
	"roach_id" uuid,
	"field" text NOT NULL,
	"from_lng" double precision,
	"from_lat" double precision,
	"to_lng" double precision,
	"to_lat" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "border_fixes_field_check" CHECK ("border_fixes"."field" in ('place', 'ride_from', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "border_fixes_done_idx" ON "border_fixes" USING btree ("run") WHERE "border_fixes"."field" = 'done';