CREATE TABLE "pass_counters" (
	"char_id" smallint PRIMARY KEY NOT NULL,
	"last_no" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pass_gifts" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pass_gifts_from_id_to_id_day_pk" PRIMARY KEY("from_id","to_id","day")
);
--> statement-breakpoint
CREATE TABLE "pass_wallets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tickets" integer DEFAULT 0 NOT NULL,
	"day" date NOT NULL,
	"social" smallint DEFAULT 0 NOT NULL,
	"guide" smallint DEFAULT 0 NOT NULL,
	"declare" smallint DEFAULT 0 NOT NULL,
	"gifts_in" smallint DEFAULT 0 NOT NULL,
	"welcomed" boolean DEFAULT false NOT NULL,
	"miss" smallint DEFAULT 0 NOT NULL,
	"wish" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"wish_day" date,
	"on_map" boolean DEFAULT true NOT NULL,
	"plain" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"drawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"char_id" smallint NOT NULL,
	"no" integer NOT NULL,
	"wish" boolean DEFAULT false NOT NULL,
	"drawn_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "worn_pass" bigint;--> statement-breakpoint
ALTER TABLE "pass_gifts" ADD CONSTRAINT "pass_gifts_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_gifts" ADD CONSTRAINT "pass_gifts_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD CONSTRAINT "pass_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pass_gifts_to_idx" ON "pass_gifts" USING btree ("to_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "passes_char_no_idx" ON "passes" USING btree ("char_id","no");--> statement-breakpoint
CREATE INDEX "passes_user_char_idx" ON "passes" USING btree ("user_id","char_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_worn_pass_passes_id_fk" FOREIGN KEY ("worn_pass") REFERENCES "public"."passes"("id") ON DELETE set null ON UPDATE no action;