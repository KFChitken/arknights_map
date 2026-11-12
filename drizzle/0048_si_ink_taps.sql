CREATE SEQUENCE "public"."si_inks_changed_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "si_inks" ALTER COLUMN "ticket" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "si_inks" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "si_inks" ADD COLUMN "recalled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "si_inks" ADD COLUMN "changed" bigint DEFAULT nextval('si_inks_changed_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "si_tickets" ADD COLUMN "recalled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "si_inks_changed_idx" ON "si_inks" USING btree ("changed");--> statement-breakpoint
CREATE INDEX "si_inks_held_idx" ON "si_inks" USING btree ("no") WHERE "si_inks"."recalled_at" is not null or "si_inks"."ticket" is null;--> statement-breakpoint
CREATE INDEX "si_tickets_recalled_idx" ON "si_tickets" USING btree ("checkin_at") WHERE "si_tickets"."recalled_at" is not null;--> statement-breakpoint
ALTER TABLE "si_inks" ADD CONSTRAINT "si_inks_public_id_unique" UNIQUE("public_id");