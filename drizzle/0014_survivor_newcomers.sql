-- 石棺里的苏醒 is now held for a week from signing up (or coming back): accounts still in
-- their first week get it for the rest of it, as if given when they signed up
INSERT INTO "user_badges" ("user_id", "badge", "earned_at")
SELECT "id", 'survivor', "created_at" FROM "users"
WHERE "demo_key" IS NULL AND "created_at" > now() - interval '7 days'
ON CONFLICT DO NOTHING;
