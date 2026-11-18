CREATE TABLE "handwriting_ratings" (
	"writing_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"meme" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handwriting_ratings_writing_id_rater_id_pk" PRIMARY KEY("writing_id","rater_id")
);
--> statement-breakpoint
CREATE TABLE "handwritings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"strokes" jsonb NOT NULL,
	"mark" smallint NOT NULL,
	"show" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	"n" integer DEFAULT 0 NOT NULL,
	"sum" integer DEFAULT 0 NOT NULL,
	"n799" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "handwritings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "handwritings_show" CHECK ("handwritings"."show" in ('anon', 'named'))
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "writing_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "write_passed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "write_deal" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "write_day" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "write_rates" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "write_skips" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "write_publishes" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "handwriting_ratings" ADD CONSTRAINT "handwriting_ratings_writing_id_handwritings_id_fk" FOREIGN KEY ("writing_id") REFERENCES "public"."handwritings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handwriting_ratings" ADD CONSTRAINT "handwriting_ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handwritings" ADD CONSTRAINT "handwritings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handwriting_ratings_rater_idx" ON "handwriting_ratings" USING btree ("rater_id","created_at");--> statement-breakpoint
CREATE INDEX "handwritings_deal_idx" ON "handwritings" USING btree ("n","created_at");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_writing_id_handwritings_id_fk" FOREIGN KEY ("writing_id") REFERENCES "public"."handwritings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_write_deal_handwritings_id_fk" FOREIGN KEY ("write_deal") REFERENCES "public"."handwritings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_writing_idx" ON "reports" USING btree ("writing_id");--> statement-breakpoint
-- Ratings that go (with their raters' accounts) take themselves off their papers' counts, sums and 799s: a statement
-- trigger, so all of an account's ratings go in one go, each paper's at once. A paper's own going takes its ratings
-- with it, and then there is nothing left to take them off.
CREATE OR REPLACE FUNCTION handwriting_ratings_deleted() RETURNS trigger AS $$
BEGIN
  UPDATE handwritings h SET n = h.n - d.n, sum = h.sum - d.sum, n799 = h.n799 - d.n799
  FROM (
    SELECT writing_id, count(*)::int AS n, sum(score)::int AS sum, (count(*) FILTER (WHERE meme))::int AS n799
    FROM old_rows GROUP BY writing_id
  ) d
  WHERE h.id = d.writing_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql SET jit = off;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER handwriting_ratings_del AFTER DELETE ON handwriting_ratings REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION handwriting_ratings_deleted();
