CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE TABLE "declarations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"template" text NOT NULL,
	"game" text,
	"character" text,
	"title" text,
	"recipients" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "declaration_deliveries" (
	"declaration_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"seen_at" timestamp with time zone,
	CONSTRAINT "declaration_deliveries_declaration_id_recipient_id_pk" PRIMARY KEY("declaration_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "friend_cuts" (
	"a" uuid NOT NULL,
	"b" uuid NOT NULL,
	"cut_at" timestamp with time zone NOT NULL,
	CONSTRAINT "friend_cuts_a_b_pk" PRIMARY KEY("a","b")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"a" uuid NOT NULL,
	"b" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_by_a" boolean DEFAULT false NOT NULL,
	"seen_by_b" boolean DEFAULT false NOT NULL,
	CONSTRAINT "friendships_a_b_pk" PRIMARY KEY("a","b")
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"email" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moves" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"from_lng" double precision,
	"from_lat" double precision,
	"to_lng" double precision,
	"to_lat" double precision,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roaches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"lng" double precision NOT NULL,
	"lat" double precision NOT NULL,
	"pub_lng" double precision NOT NULL,
	"pub_lat" double precision NOT NULL,
	"geog" "geography" GENERATED ALWAYS AS ((ST_SetSRID(ST_MakePoint(lng, lat), 4326))::geography) STORED,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roaches_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"bold" boolean NOT NULL,
	"to_slot" smallint,
	"to_public_id" uuid,
	"reply_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"age_confirmed_at" timestamp with time zone,
	"policy_accepted_at" timestamp with time zone,
	"anonymous" boolean DEFAULT true NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"dr_prefix" boolean DEFAULT false NOT NULL,
	"games" text[] DEFAULT '{}'::text[] NOT NULL,
	"fav_arknights" text[] DEFAULT '{}'::text[] NOT NULL,
	"fav_endfield" text[] DEFAULT '{}'::text[] NOT NULL,
	"uid_arknights" text DEFAULT '' NOT NULL,
	"uid_endfield" text DEFAULT '' NOT NULL,
	"share_uid" boolean DEFAULT false NOT NULL,
	"avatar" text DEFAULT 'hood' NOT NULL,
	"color" text DEFAULT 'cyan' NOT NULL,
	"demo_key" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_demo_key_unique" UNIQUE("demo_key")
);
--> statement-breakpoint
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_deliveries" ADD CONSTRAINT "declaration_deliveries_declaration_id_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."declarations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_deliveries" ADD CONSTRAINT "declaration_deliveries_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_a_users_id_fk" FOREIGN KEY ("a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_b_users_id_fk" FOREIGN KEY ("b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moves" ADD CONSTRAINT "moves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roaches" ADD CONSTRAINT "roaches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "touches" ADD CONSTRAINT "touches_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "declarations_sender_idx" ON "declarations" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_recipient_idx" ON "declaration_deliveries" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "friendships_b_idx" ON "friendships" USING btree ("b");--> statement-breakpoint
CREATE INDEX "moves_at_idx" ON "moves" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "roaches_user_slot_idx" ON "roaches" USING btree ("user_id","slot");--> statement-breakpoint
CREATE INDEX "roaches_geog_idx" ON "roaches" USING gist ("geog");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "touches_to_idx" ON "touches" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "touches_from_idx" ON "touches" USING btree ("from_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "touches_reply_idx" ON "touches" USING btree ("from_user_id","reply_to");