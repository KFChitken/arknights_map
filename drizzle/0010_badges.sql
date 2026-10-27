CREATE SEQUENCE "public"."first_batch_serial" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "worn_badge" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "friends_ever" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- What players did before badges existed, counted once. The thresholds are those of src/lib/badges.ts;
-- the friend tiers and 外交部发言人 follow from these counts at every start (catchUpBadges).
UPDATE "users" SET "friends_ever" = (SELECT count(*) FROM "friendships" f WHERE f."a" = "users"."id" OR f."b" = "users"."id");--> statement-breakpoint
INSERT INTO "user_badges" ("user_id", "badge", "serial")
SELECT "id", 'firstbatch', "n" FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS "n" FROM "users" WHERE "demo_key" IS NULL
) s WHERE "n" <= 1000
ON CONFLICT DO NOTHING;--> statement-breakpoint
SELECT setval('first_batch_serial', (SELECT count(*) FROM "user_badges" WHERE "badge" = 'firstbatch') + 1, false);--> statement-breakpoint
INSERT INTO "user_badges" ("user_id", "badge")
SELECT p."user_id", 'farwhisker'
FROM "friendships" f
JOIN "roaches" ra ON ra."user_id" = f."a" AND ra."slot" = 0
JOIN "roaches" rb ON rb."user_id" = f."b" AND rb."slot" = 0
CROSS JOIN LATERAL (VALUES (f."a"), (f."b")) AS p("user_id")
WHERE ST_Distance(ra."geog", rb."geog") >= 1000000
ON CONFLICT DO NOTHING;
