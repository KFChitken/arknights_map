CREATE TABLE "admin_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"by_user_id" uuid,
	"by_alias" text NOT NULL,
	"rule" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"answer" text
);
--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_requests" ADD CONSTRAINT "admin_requests_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_requests_open_idx" ON "admin_requests" USING btree ("user_id") WHERE "admin_requests"."answered_at" is null;--> statement-breakpoint
CREATE INDEX "admin_requests_answered_idx" ON "admin_requests" USING btree ("answered_at");--> statement-breakpoint
CREATE INDEX "admin_log_action_idx" ON "admin_log" USING btree ("action_id") WHERE "admin_log"."action_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "admins_alias_idx" ON "admins" USING btree ("alias");