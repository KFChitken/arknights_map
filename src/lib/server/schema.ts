import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { RadarScan } from "../world/types";

/** PostGIS geography; only ever written through the generated column below. */
const geography = customType<{ data: string }>({ dataType: () => "geography" });

const at = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => at("created_at").notNull().defaultNow();
const emptyArray = sql`'{}'::text[]`;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null for demo players */
  email: text("email").unique(),
  createdAt: createdAt(),
  // Only when each tick was given (src/lib/consent.ts); no birth date is asked for
  ageConfirmedAt: at("age_confirmed_at"),
  policyAcceptedAt: at("policy_accepted_at"),
  /** Agreed to storage on Tencent Cloud in Hong Kong and login mail sent by Resend */
  crossBorderAcceptedAt: at("cross_border_accepted_at"),
  /** Agreed that everyone, visitors too, sees exactly where their roaches are; asked before the first one */
  publicPlaceAcceptedAt: at("public_place_accepted_at"),

  anonymous: boolean("anonymous").notNull().default(true),
  name: text("name").notNull().default(""),
  drPrefix: boolean("dr_prefix").notNull().default(false),
  games: text("games").array().notNull().default(emptyArray),
  favArknights: text("fav_arknights").array().notNull().default(emptyArray),
  favEndfield: text("fav_endfield").array().notNull().default(emptyArray),
  uidArknights: text("uid_arknights").notNull().default(""),
  uidEndfield: text("uid_endfield").notNull().default(""),
  /** The server each UID is on (games.ts SERVERS); "" until picked */
  uidServerArknights: text("uid_server_arknights").notNull().default(""),
  uidServerEndfield: text("uid_server_endfield").notNull().default(""),
  shareUid: boolean("share_uid").notNull().default(false),
  avatar: text("avatar").notNull().default("hood"),
  color: text("color").notNull().default("cyan"),
  /** 我的助战: Arknights operator names */
  support: text("support").array().notNull().default(emptyArray),
  /** The last change to it, which 触须之交 see in their history */
  supportChangedAt: at("support_changed_at"),

  /** The Beijing date of the player's latest visit; only the day, never the time */
  lastSeenOn: date("last_seen_on", { mode: "string" }),
  /** The badge shown under their name, if they wear one */
  wornBadge: text("worn_badge"),
  /** Different players they have ever become 触须之交 with; never goes down, so badge progress never does */
  friendsEver: integer("friends_ever").notNull().default(0),
  /** 摄入酒精: the main roach sleeps until then (the next 8:00 where it is), unless sobered up first */
  drunkUntil: at("drunk_until"),
  /** Times they really got drunk; never goes down, for the 酒神 badges */
  drinksTotal: integer("drinks_total").notNull().default(0),
  /** 好久没来时，蟑螂翻肚皮睡觉: their main roach may flip over while they stay away */
  flipWhenAway: boolean("flip_when_away").notNull().default(true),
  /** The Beijing day the 04:00 batch flipped their main roach over for staying away; null while it stands */
  sleptAwayOn: date("slept_away_on", { mode: "string" }),

  /** Demo players seeded in development: "t1".."t5" for testers, "n<index>" for passers-by */
  demoKey: text("demo_key").unique(),
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256 of the cookie token, so a database leak does not leak live sessions
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: at("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginCodes = pgTable("login_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  sentAt: at("sent_at").notNull().defaultNow(),
  expiresAt: at("expires_at").notNull(),
  attempts: smallint("attempts").notNull().default(0),
  /** Codes sent to this address since dayStart, for the daily cap */
  dayStart: at("day_start").notNull().defaultNow(),
  sentToday: smallint("sent_today").notNull().default(1),
});

/** One row per email handed to the mail provider in the last day, for the sitewide cap. No address is kept. */
export const mailSends = pgTable("mail_sends", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  sentAt: at("sent_at").notNull().defaultNow(),
  /** "login" for a code, "report" for the admin's report digest */
  kind: text("kind").notNull().default("login"),
});

/**
 * slot 0 is the main roach, 1..MAX_CLONES are clones. Everyone sees a roach
 * where it was placed, but never its owner. publicId is regenerated on every
 * move so a roach cannot be followed from one spot to the next.
 */
export const roaches = pgTable(
  "roaches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(),
    lng: doublePrecision("lng").notNull(),
    lat: doublePrecision("lat").notNull(),
    geog: geography("geog").generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(lng, lat), 4326))::geography`),
    publicId: uuid("public_id").notNull().unique().defaultRandom(),
    placedAt: at("placed_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roaches_user_slot_idx").on(t.userId, t.slot), index("roaches_geog_idx").using("gist", t.geog)],
);

export const touches = pgTable(
  "touches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bold: boolean("bold").notNull(),
    // Receiver's roach slot; null for a touch back
    toSlot: smallint("to_slot"),
    // The public id that was touched, for the once-a-day rule
    toPublicId: uuid("to_public_id"),
    // "t:<id>", "d:<id>" or "x:<id>" when this answers an inbox item
    replyTo: text("reply_to"),
    createdAt: createdAt(),
    seenAt: at("seen_at"),
    /** The receiver crawled away from it (默默爬走); the toucher is never told */
    ignoredAt: at("ignored_at"),
    /** Sent between two players when one had blocked the other: kept for the sender, never shown to the receiver */
    withheld: boolean("withheld").notNull().default(false),
  },
  (t) => [
    index("touches_to_idx").on(t.toUserId, t.createdAt),
    index("touches_from_idx").on(t.fromUserId, t.createdAt),
    uniqueIndex("touches_reply_idx").on(t.fromUserId, t.replyTo),
  ],
);

export const declarations = pgTable(
  "declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    template: text("template").notNull(),
    game: text("game"),
    character: text("character"),
    title: text("title"),
    food: text("food"),
    /** The sender's name as it was when they declared it, for 「我是<名字>…」 */
    name: text("name"),
    /** For a limited-time declaration, the id of its line in events.ts */
    line: text("line"),
    recipients: integer("recipients").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("declarations_sender_idx").on(t.senderId, t.createdAt)],
);

export const deliveries = pgTable(
  "declaration_deliveries",
  {
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => declarations.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seenAt: at("seen_at"),
  },
  (t) => [primaryKey({ columns: [t.declarationId, t.recipientId] }), index("deliveries_recipient_idx").on(t.recipientId)],
);

/** A recipient's one fixed reply to a declaration; the sender sees it without learning who. */
export const reactions = pgTable(
  "declaration_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    declarationId: uuid("declaration_id")
      .notNull()
      .references(() => declarations.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    createdAt: createdAt(),
    /** When the declaration's sender saw it */
    seenAt: at("seen_at"),
    /** As for touches: one of the two had blocked the other, so the sender never sees it */
    withheld: boolean("withheld").notNull().default(false),
  },
  (t) => [uniqueIndex("reactions_once_idx").on(t.declarationId, t.fromUserId)],
);

/** 触须之交. The pair is stored with a < b. */
export const friendships = pgTable(
  "friendships",
  {
    a: uuid("a")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    b: uuid("b")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    seenByA: boolean("seen_by_a").notNull().default(false),
    seenByB: boolean("seen_by_b").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.a, t.b] }), index("friendships_b_idx").on(t.b)],
);

/** When a pair last stopped being 触须之交; only touches after it count towards a new friendship. */
export const friendCuts = pgTable(
  "friend_cuts",
  {
    a: uuid("a").notNull(),
    b: uuid("b").notNull(),
    cutAt: at("cut_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.a, t.b] })],
);

/**
 * One player blocked another. From then on nothing new passes between them in
 * either direction, and the blocker no longer sees anything the other sent
 * before. The blocked player is never told.
 */
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The blocker had seen who it was (a bold touch or a 触须之交); the block list names only those */
    known: boolean("known").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("blocks_pair_idx").on(t.blockerId, t.blockedId), index("blocks_blocked_idx").on(t.blockedId)],
);

/** A report for the admin. The reported player never learns who sent it. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    note: text("note").notNull().default(""),
    /** What the reporter was looking at, and the target's name at the time */
    context: text("context").notNull(),
    targetName: text("target_name").notNull(),
    createdAt: createdAt(),
    /** When the admin was emailed about it */
    notifiedAt: at("notified_at"),
    resolvedAt: at("resolved_at"),
    /** "dismissed" or "name_cleared"; a ban deletes the reports with the account */
    resolution: text("resolution"),
  },
  (t) => [index("reports_target_idx").on(t.targetId), index("reports_reporter_idx").on(t.reporterId, t.createdAt)],
);

/** Addresses of banned accounts, kept only as an HMAC so the list holds nobody's email. */
export const bannedEmails = pgTable("banned_emails", {
  emailHash: text("email_hash").primaryKey(),
  createdAt: createdAt(),
});

/** Words no name may contain (or be, when whole), kept on the admin page and never in the repository (src/lib/nameRules.ts). */
export const nameWords = pgTable("name_words", {
  /** As cleaned by bare() */
  word: text("word").primaryKey(),
  whole: boolean("whole").notNull().default(false),
  createdAt: createdAt(),
});

/** A player's radar scans of the last day (counts only), to cap them and show the last one again. */
export const radarScans = pgTable(
  "radar_scans",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    result: jsonb("result").$type<RadarScan>().notNull(),
    /** Where the main roach was, so a scan is only shown again for the same spot */
    lng: doublePrecision("lng"),
    lat: doublePrecision("lat"),
    createdAt: createdAt(),
  },
  (t) => [index("radar_scans_user_idx").on(t.userId, t.createdAt)],
);

/** 首批蟑螂 numbers; a number is never given out again, even after its owner leaves */
export const firstBatchSerial = pgSequence("first_batch_serial");

/**
 * Badges a player has earned. They are written the moment they are earned and
 * kept even after what earned them is gone, such as a declaration past the
 * 90-day clean-up.
 */
export const userBadges = pgTable(
  "user_badges",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badge: text("badge").notNull(),
    earnedAt: at("earned_at").notNull().defaultNow(),
    /** Only for 首批蟑螂: the player's number, never given to anyone else */
    serial: smallint("serial"),
    /** When the player was shown they had earned it */
    seenAt: at("seen_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badge] })],
);

/**
 * Sitewide totals, one row per Beijing day, for the admin's retention numbers.
 * Only counts: nothing in it points at any player.
 */
export const dailyTotals = pgTable("daily_totals", {
  day: date("day", { mode: "string" }).primaryKey(),
  /** Players who came on any of the 7 days up to and including this one */
  activeWeek: integer("active_week").notNull(),
  /** Accounts made that day */
  signups: integer("signups").notNull(),
  /** Pairs who became 触须之交 that day */
  friendships: integer("friendships").notNull(),
});

/** Placements, moves and removals, for the radar. */
export const moves = pgTable(
  "moves",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slot: smallint("slot").notNull(),
    fromLng: doublePrecision("from_lng"),
    fromLat: doublePrecision("from_lat"),
    toLng: doublePrecision("to_lng"),
    toLat: doublePrecision("to_lat"),
    at: at("at").notNull().defaultNow(),
    // so the radar reads only moves that start or end near it; null where there is no point
    fromGeog: geography("from_geog").generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(from_lng, from_lat), 4326))::geography`),
    toGeog: geography("to_geog").generatedAlwaysAs(sql`(ST_SetSRID(ST_MakePoint(to_lng, to_lat), 4326))::geography`),
  },
  (t) => [
    index("moves_at_idx").on(t.at),
    index("moves_from_geog_idx").using("gist", t.fromGeog),
    index("moves_to_geog_idx").using("gist", t.toGeog),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type RoachRow = typeof roaches.$inferSelect;
