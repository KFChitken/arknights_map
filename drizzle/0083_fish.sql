CREATE TABLE "fish_days" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"casts" smallint DEFAULT 0 NOT NULL,
	"dry" smallint DEFAULT 0 NOT NULL,
	"junk" smallint DEFAULT 0 NOT NULL,
	"admiral" boolean DEFAULT false NOT NULL,
	"tickets" smallint DEFAULT 0 NOT NULL,
	"bottles" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "fish_days_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "fish_dex" (
	"user_id" uuid NOT NULL,
	"item" smallint NOT NULL,
	"variant" smallint DEFAULT 0 NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"best" integer,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_spot" text NOT NULL,
	CONSTRAINT "fish_dex_user_id_item_variant_pk" PRIMARY KEY("user_id","item","variant")
);
--> statement-breakpoint
CREATE TABLE "fish_lines" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"spot" text NOT NULL,
	"cast_at" timestamp with time zone NOT NULL,
	"bite_at" timestamp with time zone NOT NULL,
	"item" smallint NOT NULL,
	"variant" smallint DEFAULT 0 NOT NULL,
	"cm" integer,
	"shadow" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fish_records" (
	"item" smallint NOT NULL,
	"variant" smallint DEFAULT 0 NOT NULL,
	"cm" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fish_records_item_variant_pk" PRIMARY KEY("item","variant")
);
--> statement-breakpoint
CREATE TABLE "fish_shouts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"spot" text NOT NULL,
	"item" smallint NOT NULL,
	"variant" smallint DEFAULT 0 NOT NULL,
	"cm" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fish_days" ADD CONSTRAINT "fish_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fish_dex" ADD CONSTRAINT "fish_dex_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fish_lines" ADD CONSTRAINT "fish_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fish_shouts" ADD CONSTRAINT "fish_shouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fish_lines_spot_idx" ON "fish_lines" USING btree ("spot");--> statement-breakpoint
CREATE INDEX "fish_shouts_at_idx" ON "fish_shouts" USING btree ("at");