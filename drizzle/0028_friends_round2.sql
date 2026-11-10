CREATE TABLE "friend_stars" (
	"user_id" uuid NOT NULL,
	"other" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_stars_user_id_other_pk" PRIMARY KEY("user_id","other")
);
--> statement-breakpoint
CREATE TABLE "help_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"clues" smallint[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "help_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"game" text NOT NULL,
	"clues" smallint[],
	"operator" text,
	"skill" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "help_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "friend_stars" ADD CONSTRAINT "friend_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_answers" ADD CONSTRAINT "help_answers_request_id_help_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."help_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_answers" ADD CONSTRAINT "help_answers_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "help_answers_once_idx" ON "help_answers" USING btree ("request_id","from_user_id");--> statement-breakpoint
CREATE INDEX "help_answers_from_idx" ON "help_answers" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "help_requests_user_idx" ON "help_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "help_requests_expires_idx" ON "help_requests" USING btree ("expires_at");