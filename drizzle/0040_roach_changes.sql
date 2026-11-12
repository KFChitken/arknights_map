CREATE TABLE "roach_changes" (
	"n" bigserial PRIMARY KEY NOT NULL,
	"public_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "roach_changes_at_idx" ON "roach_changes" USING btree ("created_at");--> statement-breakpoint
-- What every web process reads to change only those roaches in its copy of the map (src/lib/server/roachFeed.ts):
-- the public id of a roach put down, taken back, moved, given a new public id (both ids) or getting on or off
-- 明河都尉's horse, and of every roach of a player whose look, colour or sleep changed.
--
-- Put down and taken back: statement triggers, so a batch (a player's account gone) writes its rows in one go;
-- each reads only its own rows, the same way whatever their number. Updated: row triggers, which run only when
-- one of those columns really changed and look up nothing but that row's own (by index). A statement trigger
-- that compares its old and new rows keeps, on each connection, the plan made for the first batch it saw:
-- after one row, a batch of 20,000 took minutes; after a batch, each single row read the whole table.
-- No JIT for the statement ones: a plan made for a big batch would compile on every later call.
CREATE OR REPLACE FUNCTION roaches_inserted() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id) SELECT public_id FROM new_rows;
  RETURN NULL;
END $$ LANGUAGE plpgsql SET jit = off;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION roaches_deleted() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id) SELECT public_id FROM old_rows;
  RETURN NULL;
END $$ LANGUAGE plpgsql SET jit = off;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION roaches_updated() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id) VALUES (OLD.public_id);
  IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    INSERT INTO roach_changes (public_id) VALUES (NEW.public_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION roach_owners_updated() RETURNS trigger AS $$
BEGIN
  INSERT INTO roach_changes (public_id) SELECT public_id FROM roaches WHERE user_id = NEW.id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER roach_changes_ins AFTER INSERT ON roaches REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION roaches_inserted();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER roach_changes_del AFTER DELETE ON roaches REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION roaches_deleted();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER roach_changes_upd AFTER UPDATE OF public_id, lng, lat, slot, ride_since ON roaches FOR EACH ROW
  WHEN (OLD.public_id IS DISTINCT FROM NEW.public_id OR OLD.lng IS DISTINCT FROM NEW.lng OR OLD.lat IS DISTINCT FROM NEW.lat
    OR OLD.slot IS DISTINCT FROM NEW.slot OR (OLD.ride_since IS NULL) IS DISTINCT FROM (NEW.ride_since IS NULL))
  EXECUTE FUNCTION roaches_updated();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER roach_owner_changes_upd AFTER UPDATE OF avatar, color, drunk_until, slept_away_on ON users FOR EACH ROW
  WHEN (OLD.avatar IS DISTINCT FROM NEW.avatar OR OLD.color IS DISTINCT FROM NEW.color
    OR OLD.drunk_until IS DISTINCT FROM NEW.drunk_until OR OLD.slept_away_on IS DISTINCT FROM NEW.slept_away_on)
  EXECUTE FUNCTION roach_owners_updated();
