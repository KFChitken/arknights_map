ALTER TABLE "moves" ADD COLUMN "from_geog" "geography" GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326))::geography) STORED;--> statement-breakpoint
ALTER TABLE "moves" ADD COLUMN "to_geog" "geography" GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326))::geography) STORED;--> statement-breakpoint
ALTER TABLE "radar_scans" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "radar_scans" ADD COLUMN "lat" double precision;--> statement-breakpoint
CREATE INDEX "moves_from_geog_idx" ON "moves" USING gist ("from_geog");--> statement-breakpoint
CREATE INDEX "moves_to_geog_idx" ON "moves" USING gist ("to_geog");