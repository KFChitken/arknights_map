CREATE TABLE "roach_changes" (
	"n" bigserial PRIMARY KEY NOT NULL,
	"public_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "roach_changes_at_idx" ON "roach_changes" USING btree ("created_at");--> statement-breakpoint
-- What every web process reads to change only those roaches in its copy of the map (src/lib/server/roachFeed.ts):
-- the public id of a roach put down, taken back, moved, given a new public id (both ids) or getting on or off
-- 明河都尉's horse, and of every roach of a player whose look, colour or sleep changed. Statement triggers, so a
-- batch (the 04:00 flips, a player's account gone) writes its rows in one go.
CREATE OR REPLACE FUNCTION roaches_inserted() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id) SELECT public_id FROM new_rows;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION roaches_deleted() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id) SELECT public_id FROM old_rows;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION roaches_updated() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id)
  SELECT o.public_id FROM old_rows o JOIN new_rows n ON n.id = o.id
  WHERE n.public_id IS DISTINCT FROM o.public_id OR n.lng IS DISTINCT FROM o.lng OR n.lat IS DISTINCT FROM o.lat
    OR n.slot IS DISTINCT FROM o.slot OR (n.ride_since IS NULL) IS DISTINCT FROM (o.ride_since IS NULL)
  UNION ALL
  SELECT n.public_id FROM old_rows o JOIN new_rows n ON n.id = o.id WHERE n.public_id IS DISTINCT FROM o.public_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION roach_owners_updated() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id)
  SELECT r.public_id FROM old_rows o JOIN new_rows n ON n.id = o.id JOIN roaches r ON r.user_id = n.id
  WHERE n.avatar IS DISTINCT FROM o.avatar OR n.color IS DISTINCT FROM o.color
    OR n.drunk_until IS DISTINCT FROM o.drunk_until OR n.slept_away_on IS DISTINCT FROM o.slept_away_on;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS roach_changes_ins ON roaches;
--> statement-breakpoint
CREATE TRIGGER roach_changes_ins AFTER INSERT ON roaches REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION roaches_inserted();
--> statement-breakpoint
DROP TRIGGER IF EXISTS roach_changes_del ON roaches;
--> statement-breakpoint
CREATE TRIGGER roach_changes_del AFTER DELETE ON roaches REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION roaches_deleted();
--> statement-breakpoint
DROP TRIGGER IF EXISTS roach_changes_upd ON roaches;
--> statement-breakpoint
CREATE TRIGGER roach_changes_upd AFTER UPDATE ON roaches REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION roaches_updated();
--> statement-breakpoint
DROP TRIGGER IF EXISTS roach_owner_changes_upd ON users;
--> statement-breakpoint
CREATE TRIGGER roach_owner_changes_upd AFTER UPDATE ON users REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION roach_owners_updated();
