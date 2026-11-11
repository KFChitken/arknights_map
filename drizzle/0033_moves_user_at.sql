-- Made on the live database first, without stopping writes (CREATE INDEX CONCURRENTLY, 11/11), so only
-- where it is not there yet
CREATE INDEX IF NOT EXISTS "moves_user_at_idx" ON "moves" USING btree ("user_id","at");
