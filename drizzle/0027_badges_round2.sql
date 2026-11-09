ALTER TABLE "users" ADD COLUMN "declare_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "declared_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "declared_lines" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "react_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reacted_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "amiya_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "amiya_touched_on" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perlica_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perlica_touched_on" date;--> statement-breakpoint
-- the new badges' counts from what is still kept (90 days of declarations, reactions and guide touches), in Beijing days
UPDATE "users" SET "declare_days" = d."days", "declared_on" = d."last"
FROM (SELECT "sender_id", count(DISTINCT ("created_at" AT TIME ZONE 'Asia/Shanghai')::date)::int AS "days", max(("created_at" AT TIME ZONE 'Asia/Shanghai')::date) AS "last"
  FROM "declarations" GROUP BY "sender_id") d
WHERE d."sender_id" = "users"."id";--> statement-breakpoint
UPDATE "users" SET "declared_lines" = l."lines"
FROM (SELECT "sender_id", array_agg(DISTINCT "template") AS "lines" FROM "declarations"
  WHERE "line" IS NULL AND "template" IN ('launch', 'iam', 'love', 'buff', 'myname', 'welcome', 'canyou', 'eat') GROUP BY "sender_id") l
WHERE l."sender_id" = "users"."id";--> statement-breakpoint
UPDATE "users" SET "react_days" = r."days", "reacted_on" = r."last"
FROM (SELECT "from_user_id", count(DISTINCT ("created_at" AT TIME ZONE 'Asia/Shanghai')::date)::int AS "days", max(("created_at" AT TIME ZONE 'Asia/Shanghai')::date) AS "last"
  FROM "declaration_reactions" WHERE NOT "withheld" GROUP BY "from_user_id") r
WHERE r."from_user_id" = "users"."id";--> statement-breakpoint
UPDATE "users" SET "amiya_days" = a."days", "amiya_touched_on" = a."last"
FROM (SELECT "user_id", count(DISTINCT ("created_at" AT TIME ZONE 'Asia/Shanghai')::date)::int AS "days", max(("created_at" AT TIME ZONE 'Asia/Shanghai')::date) AS "last"
  FROM "amiya_touches" WHERE "direction" = 'to_amiya' GROUP BY "user_id") a
WHERE a."user_id" = "users"."id";--> statement-breakpoint
UPDATE "users" SET "perlica_days" = p."days", "perlica_touched_on" = p."last"
FROM (SELECT "user_id", count(DISTINCT ("created_at" AT TIME ZONE 'Asia/Shanghai')::date)::int AS "days", max(("created_at" AT TIME ZONE 'Asia/Shanghai')::date) AS "last"
  FROM "perlica_touches" WHERE "direction" = 'to_perlica' GROUP BY "user_id") p
WHERE p."user_id" = "users"."id";
