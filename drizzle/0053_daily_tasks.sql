ALTER TABLE "pass_wallets" ADD COLUMN "touch" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD COLUMN "reply" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD COLUMN "npc" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD COLUMN "touch_got" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD COLUMN "declare_got" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD COLUMN "reply_got" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pass_wallets" ADD COLUMN "npc_got" smallint DEFAULT 0 NOT NULL;