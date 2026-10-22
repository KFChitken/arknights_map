import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
  // Only the fact that the checks passed is kept, never the birth date
  ageConfirmedAt: at("age_confirmed_at"),
  policyAcceptedAt: at("policy_accepted_at"),

  anonymous: boolean("anonymous").notNull().default(true),
  name: text("name").notNull().default(""),
  drPrefix: boolean("dr_prefix").notNull().default(false),
  games: text("games").array().notNull().default(emptyArray),
  favArknights: text("fav_arknights").array().notNull().default(emptyArray),
  favEndfield: text("fav_endfield").array().notNull().default(emptyArray),
  uidArknights: text("uid_arknights").notNull().default(""),
  uidEndfield: text("uid_endfield").notNull().default(""),
  shareUid: boolean("share_uid").notNull().default(false),
  avatar: text("avatar").notNull().default("hood"),
  color: text("color").notNull().default("cyan"),

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
    // "t:<id>" or "d:<id>" when this answers an inbox item
    replyTo: text("reply_to"),
    createdAt: createdAt(),
    seenAt: at("seen_at"),
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
  },
  (t) => [index("moves_at_idx").on(t.at)],
);

export type UserRow = typeof users.$inferSelect;
export type RoachRow = typeof roaches.$inferSelect;
