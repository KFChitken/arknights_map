CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"pop" text DEFAULT 'none' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "notices_pop_check" CHECK ("notices"."pop" in ('none', 'once', 'every')),
	CONSTRAINT "notices_status_check" CHECK ("notices"."status" in ('draft', 'live', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notices_status_published_idx" ON "notices" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "notices_one_every" ON "notices" USING btree ((true)) WHERE "notices"."status" = 'live' and "notices"."pop" = 'every';--> statement-breakpoint
-- The notice everyone signed in has seen on every visit since 11/11 (it was src/components/app/NoticeSheet.tsx),
-- word for word, dated when that version went live
INSERT INTO "notices" ("title", "body", "pop", "pinned", "status", "published_at") VALUES (
'欢迎来到舟P地图',
'大家好，我是 Breeze！一转眼地图上已经快 8 万只蟑螂了，真的谢谢大家 (≧▽≦) 人多起来以后，有几件事更想拜托大家：

## 1. 保护隐私｜保护自己｜保护网站
- 别把蟑螂放在自己的住址（家门口、宿舍楼下），放在附近的商场、地铁站就好。已经放了的，在「我的蟑螂」里点「挪窝」。
- UID 栏只填游戏 UID，别写 QQ、微信、手机号。

舟P地图希望舟u们玩得开心，但最不希望的，是给有心之人搭了桥。保护好个人隐私，网站也能更耐活～

## 2. 不要用蟑螂摆能认出来的字或图案
明白大家想玩 325 这些梗，之后会加上的！但地图上的所有东西都要谨慎，我们不是 wplace。

## 3. 守护地图社区，必要时举报
为了让舟u们都有好的体验，发现任何可疑行为，请记得举报或直接反馈，交给站长处理：
- 消息里每条下面、TA 的资料页最下面、地图上蟑螂的卡片里，都能举报。
- 举报只有站长看得到，TA 不会知道是谁；处理完会在消息里告诉你结果。

## 4. 关注近期 & 后续更新
- 服务器升级了（买！）
- 验证码额度 +100%（买！）
- 高德地图应该更丝滑了
- 正在为 10 万舟u做准备！晚上人多时线路偶尔被限流，可能会卡一下～

后续更新请关注 B站「[Breeze青嵐](https://space.bilibili.com/481828661)」；任何反馈欢迎加企鹅群 1108446109：

【Q群二维码】

再次感谢大家！',
'every', true, 'live', '2026-11-11 15:08:00+08');
