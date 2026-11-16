import "server-only";
import { and, asc, count, desc, eq, gte, inArray, like, not, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { T } from "@/i18n";
import { declarationText, isDrunkTemplate, replyOf } from "../declarations";
import type { GuideId } from "../guides";
import { goldKind } from "../passes";
import { INBOX_DAYS } from "../rules";
import type { FriendEvent } from "../world/types";
import { displayName } from "../profile";
import {
  DAY_INDEX,
  dayStart,
  localDay,
  localHour,
  RANGES,
  RECORD_DAYS,
  isRecordCat,
  TIMELINE_KINDS,
  TIMELINE_PAGE,
  type ByRange,
  type DayField,
  type FriendRecord,
  type PassRecords,
  type RecordCat,
  type RecordDir,
  type RecordsLite,
  type RecordsSummary,
  type RecordWho,
  type TimelineItem,
  type TimelineKindFilter,
  type TimelinePage,
  type TimelineQuery,
} from "../records";
import { blockedBy } from "./blocks";
import { db } from "./db";
import { recordsOpen } from "./recordsOpen";
import { passesOpen } from "./passes";
import {
  amiyaTouches,
  declarationSpots,
  declarations,
  drinks,
  friendCuts,
  friendNotes,
  friendships,
  mingheTouches,
  moves,
  passes,
  perlicaTouches,
  pokes,
  reactions,
  siInks,
  siTouches,
  talulahTouches,
  touches,
  userBadges,
  users,
  type UserRow,
} from "./schema";
import { friendKey, profileOf, storedDeclaration } from "./world";

/**
 * 「我的记录」 (src/lib/records.ts): a player's own records, for them alone. Everything here is read from what the site
 * keeps anyway, by indexes on the player; nothing is written. Others in it are named only as the inbox names them:
 * never who touched sneakily, nor who reacted, and nothing at all of players they blocked.
 */

export { recordsOpen };

/** The 小动作 and 催理智 among the notes between 触须之交 */
const GESTURES = ["hug", "highfive", "luck", "sanity", "blanket", "water"];
const GUIDE_TABLES = [amiyaTouches, perlicaTouches, talulahTouches, mingheTouches, siTouches] as const;

// a minute's answers kept, so a page reopened at once asks the database nothing. A summary is 25 to 35 kB in memory,
// so the answers are held oldest first, each goes once its minute is up, and never more than KEEP_MAX are held
const KEEP_MS = 60_000;
const KEEP_MAX = 1_000;
const g = globalThis as unknown as { recordsKept?: Map<string, { at: number; value: unknown }> };
const kept = (g.recordsKept ??= new Map());

async function keptFor<T>(key: string, make: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = kept.get(key);
  if (hit && now - hit.at < KEEP_MS) return hit.value as T;
  const value = await make();
  kept.delete(key);
  for (const [k, v] of kept) {
    if (now - v.at < KEEP_MS && kept.size < KEEP_MAX) break;
    kept.delete(k);
  }
  kept.set(key, { at: now, value });
  return value;
}

/** Tests: nothing kept */
export const forgetRecords = () => kept.clear();
/** Tests: how many answers are held */
export const keptAnswers = () => kept.size;

/** Which ranges a day i days back falls in: 7, 30 and 90 */
const inRanges = (i: number): [boolean, boolean, boolean] => [i < RANGES[0], i < RANGES[1], i < RANGES[2]];
const addTo = (r: ByRange, i: number) => {
  const [a, b, c] = inRanges(i);
  if (a) r[0]++;
  if (b) r[1]++;
  if (c) r[2]++;
};

/** The summary: every day's numbers, the hours, the sentences and reactions, 触须之交, drinks and totals */
export function recordsSummary(user: UserRow, offset: number, now = Date.now()): Promise<RecordsSummary> {
  return keptFor(`s:${user.id}:${offset}`, () => summarize(user, offset, now), now);
}

/** 「我的资料」's card: the last 7 days of touches sent and got, and declarations */
export function recordsLite(user: UserRow, offset: number, now = Date.now()): Promise<RecordsLite> {
  return keptFor(`l:${user.id}:${offset}`, () => lite(user, offset, now), now);
}

async function summarize(user: UserRow, offset: number, now: number): Promise<RecordsSummary> {
  const me = user.id;
  const today = localDay(now, offset);
  const from = new Date(dayStart(today - (RECORD_DAYS - 1), offset));
  const back = (at: Date | number) => today - localDay(typeof at === "number" ? at : at.getTime(), offset);
  const days = Array.from({ length: RECORD_DAYS }, () => new Array<number>(Object.keys(DAY_INDEX).length).fill(0));
  const hours: [number[], number[], number[]] = [new Array(24).fill(0), new Array(24).fill(0), new Array(24).fill(0)];
  const day = (at: Date, field: DayField, own = false) => {
    const i = back(at);
    if (i < 0 || i >= RECORD_DAYS) return;
    days[i][DAY_INDEX[field]]++;
    if (!own) return;
    const h = localHour(at.getTime(), offset);
    const [a, b, c] = inRanges(i);
    if (a) hours[0][h]++;
    if (b) hours[1][h]++;
    if (c) hours[2][h]++;
  };
  const blocked = await blockedBy(me);
  const open = passesOpen(user);

  // 触须之交 now, and when each began
  const fs = await db
    .select()
    .from(friendships)
    .where(or(eq(friendships.a, me), eq(friendships.b, me)));
  const friendSince = new Map(fs.map((f) => [f.a === me ? f.b : f.a, f.createdAt.getTime()]));
  const friendCounts = new Map<string, { touch: ByRange; gest: ByRange; poke: ByRange }>();
  for (const id of friendSince.keys()) friendCounts.set(id, { touch: [0, 0, 0], gest: [0, 0, 0], poke: [0, 0, 0] });
  const forFriend = (id: string, what: "touch" | "gest" | "poke", at: Date) => {
    const c = friendCounts.get(id);
    if (c) addTo(c[what], back(at));
  };

  // touches, both ways
  const sent = (
    await db
      .select({ at: touches.createdAt, bold: touches.bold, to: touches.toUserId, replyTo: touches.replyTo })
      .from(touches)
      .where(and(eq(touches.fromUserId, me), gte(touches.createdAt, from)))
  ).filter((t) => !blocked.has(t.to));
  const answered = new Set(sent.filter((t) => t.replyTo?.startsWith("t:")).map((t) => t.replyTo!.slice(2)));
  for (const t of sent) {
    day(t.at, t.bold ? "outBold" : "outSneaky", true);
    forFriend(t.to, "touch", t.at);
  }
  const got = (
    await db
      .select({ id: touches.id, at: touches.createdAt, bold: touches.bold, slot: touches.toSlot, from: touches.fromUserId, ignored: touches.ignoredAt, replyTo: touches.replyTo })
      .from(touches)
      .where(and(eq(touches.toUserId, me), eq(touches.withheld, false), gte(touches.createdAt, from)))
  ).filter((t) => !blocked.has(t.from));
  const SLOTS: DayField[] = ["inMain", "inClone1", "inClone2", "inClone3"];
  for (const t of got) {
    day(t.at, t.bold ? "inBold" : "inSneaky");
    if (t.slot !== null && t.slot >= 0 && t.slot < SLOTS.length) day(t.at, SLOTS[t.slot]);
    if (answered.has(t.id)) day(t.at, "touchedBack");
    if (t.ignored) day(t.at, "crawled");
    if (t.bold && t.replyTo?.startsWith("t:")) day(t.at, "backBold");
    // a sneaky one never says who, 触须之交 or not
    if (t.bold) forFriend(t.from, "touch", t.at);
  }

  // declarations, and the reactions given and got
  const said = await db
    .select()
    .from(declarations)
    .where(and(eq(declarations.senderId, me), gte(declarations.createdAt, from)));
  const lines = new Map<string, ByRange>();
  for (const d of said) {
    day(d.createdAt, "declared", true);
    const text = d.template === "listen" ? T.server.records.listenLine : declarationText(storedDeclaration(d));
    if (!lines.has(text)) lines.set(text, [0, 0, 0]);
    addTo(lines.get(text)!, back(d.createdAt));
  }
  const gave = (
    await db
      .select({ at: reactions.createdAt, to: declarations.senderId })
      .from(reactions)
      .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
      .where(and(eq(reactions.fromUserId, me), gte(reactions.createdAt, from)))
  ).filter((r) => !blocked.has(r.to));
  for (const r of gave) day(r.at, "reactedOut", true);
  const heard = (
    await db
      .select({ at: reactions.createdAt, reaction: reactions.reaction, from: reactions.fromUserId, d: declarations })
      .from(reactions)
      .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
      .where(and(eq(declarations.senderId, me), eq(reactions.withheld, false), gte(reactions.createdAt, from)))
  ).filter((r) => !blocked.has(r.from));
  const reactionWords = new Map<string, ByRange>();
  for (const r of heard) {
    day(r.at, "reactedIn");
    const words = replyOf(storedDeclaration(r.d), r.reaction)?.text;
    if (!words) continue;
    if (!reactionWords.has(words)) reactionWords.set(words, [0, 0, 0]);
    addTo(reactionWords.get(words)!, back(r.at));
  }

  // 小动作, 催理智 and 寻访券 between 触须之交; never 想一起听, which names a song
  const notes = (
    await Promise.all([
      db
        .select({ at: friendNotes.createdAt, kind: friendNotes.kind, other: friendNotes.toUserId, mine: friendNotes.fromUserId })
        .from(friendNotes)
        .where(and(eq(friendNotes.fromUserId, me), gte(friendNotes.createdAt, from))),
      db
        .select({ at: friendNotes.createdAt, kind: friendNotes.kind, other: friendNotes.fromUserId, mine: friendNotes.fromUserId })
        .from(friendNotes)
        .where(and(eq(friendNotes.toUserId, me), gte(friendNotes.createdAt, from))),
    ])
  )
    .flat()
    .filter((n) => !blocked.has(n.other));
  for (const n of notes) {
    const own = n.mine === me;
    if (GESTURES.includes(n.kind)) {
      day(n.at, "gestures", own);
      forFriend(n.other, "gest", n.at);
    } else if (n.kind === "gift" && open) {
      day(n.at, "gifts", own);
      forFriend(n.other, "gest", n.at);
    }
  }

  const poked = (
    await db
      .select({ at: pokes.createdAt, from: pokes.fromUserId, to: pokes.toUserId })
      .from(pokes)
      .where(and(or(eq(pokes.fromUserId, me), eq(pokes.toUserId, me)), gte(pokes.createdAt, from)))
  ).filter((p) => !blocked.has(p.from === me ? p.to : p.from));
  for (const p of poked) {
    day(p.at, "pokes", p.from === me);
    forFriend(p.from === me ? p.to : p.from, "poke", p.at);
  }

  // the guides: the player's own touches of them
  for (const table of GUIDE_TABLES) {
    const rows = await db
      .select({ at: table.createdAt })
      .from(table)
      .where(and(eq(table.userId, me), like(table.direction, "to\\_%"), gte(table.createdAt, from)));
    for (const r of rows) day(r.at, "guides", true);
  }

  const drank = await db
    .select({ at: drinks.at, until: drinks.until, soberAt: drinks.soberAt })
    .from(drinks)
    .where(and(eq(drinks.userId, me), gte(drinks.at, from)))
    .orderBy(drinks.at);
  for (const d of drank) day(d.at, "drinks", true);

  const moved = await db
    .select({ at: moves.at })
    .from(moves)
    .where(and(eq(moves.userId, me), gte(moves.at, from)));
  for (const m of moved) day(m.at, "moves", true);

  const earned = await db
    .select({ at: userBadges.earnedAt })
    .from(userBadges)
    .where(and(eq(userBadges.userId, me), gte(userBadges.earnedAt, from)));
  for (const b of earned) day(b.at, "badges");

  // 寻访, only while it is open to them: a draw of ten is written at one moment
  let passRecords: PassRecords | undefined;
  if (open) {
    const drawn = await db
      .select({ at: passes.drawnAt, charId: passes.charId, no: passes.no, wish: passes.wish })
      .from(passes)
      .where(eq(passes.userId, me));
    const sessions = new Set<number>();
    const perChar = new Map<number, number>();
    for (const p of drawn) {
      perChar.set(p.charId, (perChar.get(p.charId) ?? 0) + 1);
      const at = p.at.getTime();
      if (p.at >= from && !sessions.has(at)) {
        sessions.add(at);
        day(p.at, "draws", true);
      }
    }
    passRecords = {
      draws: drawn.length,
      chars: perChar.size,
      wish: drawn.filter((p) => p.wish).length,
      laser: [...perChar.values()].filter((n) => n >= 2).length,
      gold: drawn.filter((p) => goldKind(p.no) !== "").length,
    };
  }

  // 「一共」: what the 90-day clean-up counted, and what is still kept
  const [[out], [into], [declared]] = await Promise.all([
    db.select({ n: count() }).from(touches).where(eq(touches.fromUserId, me)),
    db
      .select({ n: count() })
      .from(touches)
      .where(and(eq(touches.toUserId, me), eq(touches.withheld, false))),
    db.select({ n: count() }).from(declarations).where(eq(declarations.senderId, me)),
  ]);

  // 触须之交 by name, as the inbox names them (a profile held hides it)
  const people = friendSince.size ? await db.select().from(users).where(inArray(users.id, [...friendSince.keys()])) : [];
  const friends: FriendRecord[] = people
    .map((u) => ({
      id: friendKey(me, u.id),
      name: displayName(profileOf(u)),
      since: friendSince.get(u.id)!,
      ...friendCounts.get(u.id)!,
    }))
    .sort((a, b) => b.since - a.since);

  const seen = await seenByFriends(user, now);

  const byNinety = (a: [string, ByRange], b: [string, ByRange]) => b[1][2] - a[1][2] || b[1][1] - a[1][1] || b[1][0] - a[1][0];
  return {
    today,
    days,
    hours,
    lines: [...lines].sort(byNinety).map(([text, r]) => [text, ...r]),
    reactionsIn: [...reactionWords]
      .sort(byNinety)
      .slice(0, 20)
      .map(([text, r]) => [text, ...r]),
    friends,
    drinks: drank.map((d) => ({ at: d.at.getTime(), until: d.until.getTime(), soberAt: d.soberAt?.getTime() ?? null })),
    totals: {
      visitDays: user.visitDays,
      touchesOut: user.oldTouchesOut + out.n,
      touchesIn: user.oldTouchesIn + into.n,
      declarations: user.oldDeclarations + declared.n,
      siStamps: user.siStamps,
      studyDays: user.studyDays,
    },
    ...(passRecords ? { passes: passRecords } : {}),
    seen,
  };
}

/**
 * The player's history as their 触须之交 see it on their page (world.ts friends()), from one who was in none of it:
 * touches each way, bold or not, declarations, becoming 触须之交, a change of 助战; nobody named
 */
async function seenByFriends(user: UserRow, now: number): Promise<FriendEvent[]> {
  const me = user.id;
  const since = new Date(now - INBOX_DAYS * 86_400_000);
  const history: FriendEvent[] = [];
  const ts = await db
    .select({ at: touches.createdAt, bold: touches.bold, from: touches.fromUserId })
    .from(touches)
    .where(and(or(eq(touches.fromUserId, me), eq(touches.toUserId, me)), gte(touches.createdAt, since)));
  for (const t of ts) history.push({ kind: t.from === me ? "touched" : "touchedBy", at: t.at.getTime(), bold: t.bold, you: false });
  const ds = await db
    .select()
    .from(declarations)
    .where(and(eq(declarations.senderId, me), gte(declarations.createdAt, since)));
  // as everywhere in 「我的记录」, without the song of a 一起听
  for (const d of ds) {
    history.push({ kind: "declared", at: d.createdAt.getTime(), text: d.template === "listen" ? T.server.records.listenLine : declarationText(storedDeclaration(d)) });
  }
  const fs = await db
    .select({ at: friendships.createdAt })
    .from(friendships)
    .where(or(eq(friendships.a, me), eq(friendships.b, me)));
  for (const f of fs) history.push({ kind: "befriended", at: f.at.getTime(), you: false });
  if (user.supportChangedAt && user.supportChangedAt > since && user.games.includes("arknights")) {
    history.push({ kind: "support", at: user.supportChangedAt.getTime() });
  }
  return history.sort((x, y) => y.at - x.at).slice(0, 30);
}

async function lite(user: UserRow, offset: number, now: number): Promise<RecordsLite> {
  const me = user.id;
  const today = localDay(now, offset);
  const from = new Date(dayStart(today - 6, offset));
  const blocked = await blockedBy(me);
  const out = new Array<number>(7).fill(0);
  const into = new Array<number>(7).fill(0);
  const said = new Array<number>(7).fill(0);
  const put = (list: number[], at: Date) => {
    const i = today - localDay(at.getTime(), offset);
    if (i >= 0 && i < 7) list[i]++;
  };
  const [sent, got, decl] = await Promise.all([
    db
      .select({ at: touches.createdAt, to: touches.toUserId })
      .from(touches)
      .where(and(eq(touches.fromUserId, me), gte(touches.createdAt, from))),
    db
      .select({ at: touches.createdAt, from: touches.fromUserId })
      .from(touches)
      .where(and(eq(touches.toUserId, me), eq(touches.withheld, false), gte(touches.createdAt, from))),
    db
      .select({ at: declarations.createdAt })
      .from(declarations)
      .where(and(eq(declarations.senderId, me), gte(declarations.createdAt, from))),
  ]);
  for (const t of sent) if (!blocked.has(t.to)) put(out, t.at);
  for (const t of got) if (!blocked.has(t.from)) put(into, t.at);
  for (const d of decl) put(said, d.at);
  const chars = passesOpen(user)
    ? (await db.select({ n: sql<number>`count(distinct ${passes.charId})::int` }).from(passes).where(eq(passes.userId, me)))[0].n
    : undefined;
  return { today, out, in: into, declared: said, seen: await seenByFriends(user, now), ...(chars === undefined ? {} : { passChars: chars }) };
}

// ---- the timeline ----

/** Where each item comes from, and its place among items of the same moment (later in this list, earlier in the page) */
const SOURCES = ["bd", "dr", "de", "fn", "fs", "ga", "gm", "gp", "gs", "gt", "ik", "mv", "pk", "ps", "ro", "rx", "ti", "to"] as const;
type Src = (typeof SOURCES)[number];
const isSrc = (v: unknown): v is Src => (SOURCES as readonly unknown[]).includes(v);

/** The last item shown: its moment in microseconds since 1970, its source and its row */
type Cursor = { us: bigint; src: Src; id: string };

/** A page asked for, as the address gives it; anything else in it is left out */
export function readTimelineQuery(q: URLSearchParams): TimelineQuery {
  const dir = q.get("dir");
  const cat = q.get("cat");
  const kind = q.get("kind");
  return {
    before: q.get("before"),
    dir: dir === "out" || dir === "in" ? dir : "all",
    cat: isRecordCat(cat) ? cat : "all",
    kind: (TIMELINE_KINDS as readonly (string | null)[]).includes(kind) ? (kind as TimelineKindFilter) : null,
  };
}

function readCursor(v: string | null): Cursor | null {
  const [us, src, id] = (v ?? "").split("|");
  if (!/^\d{1,19}$/.test(us ?? "") || !isSrc(src) || !id || id.length > 64) return null;
  return { us: BigInt(us), src, id };
}

/** A moment in microseconds as Postgres keeps it, for comparing to the exact moment of a row */
const moment = (us: bigint) => sql`('epoch'::timestamptz + ${us.toString()}::bigint * interval '1 microsecond')`;
const micros = (col: AnyColumn | SQL) => sql<string>`(extract(epoch from ${col}) * 1000000)::bigint`;

/** Rows of a source after the cursor, in the page's order: an earlier moment, or the same with a smaller id (or source) */
function afterCursor(src: Src, at: AnyColumn | SQL, id: SQL, idOf: (id: string) => SQL, c: Cursor | null): SQL | undefined {
  if (!c) return undefined;
  if (src < c.src) return sql`${at} <= ${moment(c.us)}`;
  if (src > c.src) return sql`${at} < ${moment(c.us)}`;
  return sql`(${at} < ${moment(c.us)} or (${at} = ${moment(c.us)} and ${id} < ${idOf(c.id)}))`;
}
const uuidId = (id: string) => sql`${/^[0-9a-f-]{36}$/i.test(id) ? id : "00000000-0000-0000-0000-000000000000"}::uuid`;
const bigId = (id: string) => sql`${/^\d{1,19}$/.test(id) ? id : "0"}::bigint`;
const textId = (id: string) => sql`${id}`;
/** Ids that are numbers sort as numbers: kept as 20 digits in the cursor and the page's order */
const padded = (n: number | string) => String(n).padStart(20, "0");

/** Each kind of item without what every item has */
type ItemOf<T> = T extends unknown ? Omit<T, "key" | "at" | "cat" | "dir"> : never;
type Raw = { us: string; src: Src; id: string; cat: RecordCat; dir: RecordDir; item: ItemOf<TimelineItem>; other?: string };

const LIMIT = TIMELINE_PAGE + 1;
const GUIDE_SOURCES: [Src, GuideId, (typeof GUIDE_TABLES)[number]][] = [
  ["ga", "amiya", amiyaTouches],
  ["gp", "perlica", perlicaTouches],
  ["gt", "talulah", talulahTouches],
  ["gm", "minghe", mingheTouches],
  ["gs", "si", siTouches],
];

/** A page of the player's records, newest first, as the inbox would name everyone in them */
export async function recordsTimeline(user: UserRow, q: TimelineQuery): Promise<TimelinePage> {
  const me = user.id;
  const c = readCursor(q.before);
  const blocked = [...(await blockedBy(me))];
  const notBlocked = (col: AnyColumn) => (blocked.length ? not(inArray(col, blocked)) : undefined);
  const open = passesOpen(user);
  const wants = (cat: RecordCat, dir: RecordDir, kind?: TimelineKindFilter) =>
    (q.cat === "all" || q.cat === cat) &&
    (q.dir === "all" || (q.dir === "out" ? dir !== "in" : dir === "in")) &&
    (!q.kind || q.kind === kind);
  const side = (dir: RecordDir) => q.dir === "all" || (q.dir === "out" ? dir !== "in" : dir === "in");
  const raws: Raw[] = [];
  const jobs: Promise<void>[] = [];
  const run = (job: () => Promise<void>) => jobs.push(job());

  if (wants("touch", "out", "tout")) {
    run(async () => {
      const rows = await db
        .select({ us: micros(touches.createdAt), id: touches.id, bold: touches.bold, slot: touches.toSlot, replyTo: touches.replyTo, to: touches.toUserId })
        .from(touches)
        .where(and(eq(touches.fromUserId, me), notBlocked(touches.toUserId), afterCursor("to", touches.createdAt, sql`${touches.id}`, uuidId, c)))
        .orderBy(desc(touches.createdAt), desc(touches.id))
        .limit(LIMIT);
      for (const r of rows) {
        raws.push({
          us: r.us,
          src: "to",
          id: r.id,
          cat: "touch",
          dir: "out",
          other: r.to,
          item: { kind: "tout", bold: r.bold, reply: Boolean(r.replyTo), clone: r.slot !== null && r.slot !== 0, who: null, got: null, replyTo: r.replyTo } as never,
        });
      }
    });
  }
  if (wants("touch", "in", "tin")) {
    run(async () => {
      const rows = await db
        .select({ us: micros(touches.createdAt), id: touches.id, bold: touches.bold, slot: touches.toSlot, replyTo: touches.replyTo, from: touches.fromUserId, ignored: touches.ignoredAt })
        .from(touches)
        .where(
          and(eq(touches.toUserId, me), eq(touches.withheld, false), notBlocked(touches.fromUserId), afterCursor("ti", touches.createdAt, sql`${touches.id}`, uuidId, c)),
        )
        .orderBy(desc(touches.createdAt), desc(touches.id))
        .limit(LIMIT);
      for (const r of rows) {
        raws.push({
          us: r.us,
          src: "ti",
          id: r.id,
          cat: "touch",
          dir: "in",
          other: r.from,
          item: {
            kind: "tin",
            bold: r.bold,
            slot: r.slot !== null && r.slot >= 0 ? r.slot : null,
            back: Boolean(r.replyTo?.startsWith("t:")),
            who: null,
            mine: r.ignored ? "ignored" : null,
          },
        });
      }
    });
  }
  if (wants("declare", "out", "decl")) {
    run(async () => {
      const rows = await db
        .select({ us: micros(declarations.createdAt), d: declarations })
        .from(declarations)
        .where(and(eq(declarations.senderId, me), afterCursor("de", declarations.createdAt, sql`${declarations.id}`, uuidId, c)))
        .orderBy(desc(declarations.createdAt), desc(declarations.id))
        .limit(LIMIT);
      for (const { us, d } of rows) {
        raws.push({
          us,
          src: "de",
          id: d.id,
          cat: "declare",
          dir: "out",
          item: {
            kind: "decl",
            text: d.template === "listen" ? T.server.records.listenLine : declarationText(storedDeclaration(d)),
            recipients: d.recipients,
            roaches: null,
            drunk: isDrunkTemplate(d.template),
            rx: [],
          },
        });
      }
    });
  }
  if (wants("declare", "in")) {
    run(async () => {
      // one item for each declaration reacted to, at the latest reaction
      const last = sql`max(${reactions.createdAt})`;
      const rows = await db
        .select({ us: micros(last), d: declarations })
        .from(reactions)
        .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
        .where(and(eq(declarations.senderId, me), eq(reactions.withheld, false), notBlocked(reactions.fromUserId)))
        .groupBy(declarations.id)
        .having(afterCursor("rx", last, sql`${declarations.id}`, uuidId, c))
        .orderBy(desc(last), desc(declarations.id))
        .limit(LIMIT);
      for (const { us, d } of rows) {
        raws.push({
          us,
          src: "rx",
          id: d.id,
          cat: "declare",
          dir: "in",
          item: {
            kind: "rxin",
            text: d.template === "listen" ? T.server.records.listenLine : declarationText(storedDeclaration(d)),
            declaredAt: d.createdAt.getTime(),
            rx: [],
          },
        });
      }
    });
  }
  if (wants("declare", "out", "rxout")) {
    run(async () => {
      const rows = await db
        .select({ us: micros(reactions.createdAt), id: reactions.id, reaction: reactions.reaction, d: declarations })
        .from(reactions)
        .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
        .where(and(eq(reactions.fromUserId, me), notBlocked(declarations.senderId), afterCursor("ro", reactions.createdAt, sql`${reactions.id}`, uuidId, c)))
        .orderBy(desc(reactions.createdAt), desc(reactions.id))
        .limit(LIMIT);
      for (const r of rows) {
        const declared = storedDeclaration(r.d);
        raws.push({
          us: r.us,
          src: "ro",
          id: r.id,
          cat: "declare",
          dir: "out",
          item: {
            kind: "rxout",
            text: r.d.template === "listen" ? T.server.records.listenLine : declarationText(declared),
            reaction: replyOf(declared, r.reaction)?.text ?? "",
          },
        });
      }
    });
  }
  if (!q.kind && wants("friend", "both")) {
    run(async () => {
      const id = sql<string>`${friendships.a}::text || '~' || ${friendships.b}::text`;
      const rows = await db
        .select({ us: micros(friendships.createdAt), id, a: friendships.a, b: friendships.b })
        .from(friendships)
        .where(and(or(eq(friendships.a, me), eq(friendships.b, me)), afterCursor("fs", friendships.createdAt, id, textId, c)))
        .orderBy(desc(friendships.createdAt), desc(id))
        .limit(LIMIT);
      for (const r of rows) {
        const other = r.a === me ? r.b : r.a;
        if (blocked.includes(other)) continue;
        raws.push({ us: r.us, src: "fs", id: r.id, cat: "friend", dir: "both", other, item: { kind: "friend", who: null } });
      }
    });
  }
  if (!q.kind && (q.cat === "all" || q.cat === "friend")) {
    // 小动作, 催理智, 串门, 游戏好友 and 寻访券 between 触须之交; never 想一起听, which names a song
    const kinds = ["hug", "highfive", "luck", "sanity", "blanket", "water", "visit", "gameAsk", "gameWant", ...(open ? ["gift"] : [])];
    for (const dir of ["out", "in"] as const) {
      if (!side(dir)) continue;
      run(async () => {
        const mine = dir === "out" ? friendNotes.fromUserId : friendNotes.toUserId;
        const theirs = dir === "out" ? friendNotes.toUserId : friendNotes.fromUserId;
        const rows = await db
          .select({ us: micros(friendNotes.createdAt), id: friendNotes.id, kind: friendNotes.kind, other: theirs, answer: friendNotes.answer, game: friendNotes.game })
          .from(friendNotes)
          .where(
            and(eq(mine, me), inArray(friendNotes.kind, kinds), notBlocked(theirs), afterCursor("fn", friendNotes.createdAt, sql`${friendNotes.id}`, uuidId, c)),
          )
          .orderBy(desc(friendNotes.createdAt), desc(friendNotes.id))
          .limit(LIMIT);
        for (const r of rows) {
          raws.push({
            us: r.us,
            src: "fn",
            id: r.id,
            cat: "friend",
            dir,
            other: r.other,
            item: { kind: "note", note: r.kind, who: null, answer: r.answer, game: r.game },
          });
        }
      });
    }
    for (const dir of ["out", "in"] as const) {
      if (!side(dir)) continue;
      run(async () => {
        const mine = dir === "out" ? pokes.fromUserId : pokes.toUserId;
        const theirs = dir === "out" ? pokes.toUserId : pokes.fromUserId;
        const rows = await db
          .select({ us: micros(pokes.createdAt), id: pokes.id, other: theirs })
          .from(pokes)
          .where(and(eq(mine, me), notBlocked(theirs), afterCursor("pk", pokes.createdAt, sql`${pokes.id}`, uuidId, c)))
          .orderBy(desc(pokes.createdAt), desc(pokes.id))
          .limit(LIMIT);
        for (const r of rows) raws.push({ us: r.us, src: "pk", id: r.id, cat: "friend", dir, other: r.other, item: { kind: "poke", who: null } });
      });
    }
  }
  if (!q.kind && (q.cat === "all" || q.cat === "guide")) {
    for (const [src, guide, table] of GUIDE_SOURCES) {
      run(async () => {
        const dirOnly = q.dir === "out" ? like(table.direction, "to\\_%") : q.dir === "in" ? like(table.direction, "from\\_%") : undefined;
        const rows = await db
          .select({ us: micros(table.createdAt), id: table.id, direction: table.direction, what: table.kind, bold: table.bold })
          .from(table)
          .where(and(eq(table.userId, me), dirOnly, afterCursor(src, table.createdAt, sql`${table.id}`, uuidId, c)))
          .orderBy(desc(table.createdAt), desc(table.id))
          .limit(LIMIT);
        for (const r of rows) {
          raws.push({
            us: r.us,
            src,
            id: r.id,
            cat: "guide",
            dir: r.direction.startsWith("to_") ? "out" : "in",
            item: { kind: "guide", guide, what: r.what, bold: r.bold },
          });
        }
      });
    }
  }
  if (!q.kind && wants("drink", "out")) {
    run(async () => {
      const rows = await db
        .select({ us: micros(drinks.at), id: drinks.id, until: drinks.until, soberAt: drinks.soberAt })
        .from(drinks)
        .where(and(eq(drinks.userId, me), afterCursor("dr", drinks.at, sql`${drinks.id}`, bigId, c)))
        .orderBy(desc(drinks.at), desc(drinks.id))
        .limit(LIMIT);
      for (const r of rows) {
        raws.push({
          us: r.us,
          src: "dr",
          id: padded(r.id),
          cat: "drink",
          dir: "out",
          item: { kind: "drink", until: r.until.getTime(), soberAt: r.soberAt?.getTime() ?? null },
        });
      }
    });
  }
  if (!q.kind && wants("roach", "out")) {
    run(async () => {
      // how far, never where
      const km = sql<number | null>`round(ST_Distance(${moves.fromGeog}, ${moves.toGeog}) / 1000)::int`;
      const rows = await db
        .select({ us: micros(moves.at), id: moves.id, slot: moves.slot, from: moves.fromLng, to: moves.toLng, km })
        .from(moves)
        .where(and(eq(moves.userId, me), afterCursor("mv", moves.at, sql`${moves.id}`, bigId, c)))
        .orderBy(desc(moves.at), desc(moves.id))
        .limit(LIMIT);
      for (const r of rows) {
        const how = r.from === null ? "put" : r.to === null ? "remove" : "move";
        raws.push({ us: r.us, src: "mv", id: padded(r.id), cat: "roach", dir: "out", item: { kind: "move", slot: r.slot, how, km: how === "move" ? r.km : null } });
      }
    });
  }
  if (!q.kind && (q.cat === "all" || q.cat === "harvest") && q.dir !== "in") {
    run(async () => {
      const rows = await db
        .select({ us: micros(userBadges.earnedAt), badge: userBadges.badge })
        .from(userBadges)
        .where(and(eq(userBadges.userId, me), afterCursor("bd", userBadges.earnedAt, sql`${userBadges.badge}`, textId, c)))
        .orderBy(desc(userBadges.earnedAt), desc(userBadges.badge))
        .limit(LIMIT);
      for (const r of rows) raws.push({ us: r.us, src: "bd", id: r.badge, cat: "harvest", dir: "out", item: { kind: "badge", badge: r.badge } });
    });
    run(async () => {
      const rows = await db
        .select({ us: micros(siInks.drawnAt), no: siInks.no, look: siInks.look })
        .from(siInks)
        .where(and(eq(siInks.userId, me), afterCursor("ik", siInks.drawnAt, sql`${siInks.no}::bigint`, bigId, c)));
      for (const r of rows) raws.push({ us: r.us, src: "ik", id: padded(r.no), cat: "harvest", dir: "out", item: { kind: "ink", no: r.no, look: r.look } });
    });
    if (open) {
      run(async () => {
        // a draw of ten is written at one moment; each card's tag counts the cards of that character before it
        const all = await db
          .select({ us: micros(passes.drawnAt), id: passes.id, charId: passes.charId, no: passes.no, wish: passes.wish })
          .from(passes)
          .where(eq(passes.userId, me))
          .orderBy(asc(passes.drawnAt), asc(passes.id));
        const had = new Map<number, number>();
        const draws = new Map<string, { charId: number; no: number; wish: boolean; tag: "new" | "laser" | "potential"; gold: string }[]>();
        for (const p of all) {
          const n = had.get(p.charId) ?? 0;
          had.set(p.charId, n + 1);
          const card = { charId: p.charId, no: p.no, wish: p.wish, tag: n === 0 ? ("new" as const) : n === 1 ? ("laser" as const) : ("potential" as const), gold: goldKind(p.no) };
          draws.set(p.us, [...(draws.get(p.us) ?? []), card]);
        }
        const before = c && (c.src > "ps" ? (us: bigint) => us < c.us : c.src < "ps" ? (us: bigint) => us <= c.us : (us: bigint, id: string) => us < c.us || (us === c.us && id < c.id));
        const pages = [...draws]
          .map(([us, cards]) => ({ us, id: padded(us), cards }))
          .filter((d) => !before || before(BigInt(d.us), d.id))
          .sort((a, b) => (BigInt(b.us) > BigInt(a.us) ? 1 : BigInt(b.us) < BigInt(a.us) ? -1 : 0))
          .slice(0, LIMIT);
        for (const d of pages) raws.push({ us: d.us, src: "ps", id: d.id, cat: "harvest", dir: "out", item: { kind: "pass", cards: d.cards } });
      });
    }
  }
  await Promise.all(jobs);

  // the page's order: the latest moment first, then the later source, then the larger id
  raws.sort((a, b) => {
    const x = BigInt(a.us);
    const y = BigInt(b.us);
    if (x !== y) return y > x ? 1 : -1;
    if (a.src !== b.src) return b.src > a.src ? 1 : -1;
    return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
  });
  const page = raws.slice(0, TIMELINE_PAGE);
  const next = raws.length > TIMELINE_PAGE ? `${page.at(-1)!.us}|${page.at(-1)!.src}|${page.at(-1)!.id}` : null;
  return { items: await finish(me, page), next };
}

/** The page's items with everyone named as the inbox would, and what each touch and declaration drew */
async function finish(me: string, page: Raw[]): Promise<TimelineItem[]> {
  const friendsNow = new Map(
    (
      await db
        .select()
        .from(friendships)
        .where(or(eq(friendships.a, me), eq(friendships.b, me)))
    ).map((f) => [f.a === me ? f.b : f.a, f.createdAt.getTime()]),
  );
  const others = [...new Set(page.map((r) => r.other).filter((x): x is string => Boolean(x)))];
  const cut = others.length
    ? new Set(
        (
          await db
            .select({ a: friendCuts.a, b: friendCuts.b })
            .from(friendCuts)
            .where(or(and(eq(friendCuts.a, me), inArray(friendCuts.b, others)), and(eq(friendCuts.b, me), inArray(friendCuts.a, others))))
        ).map((x) => (x.a === me ? x.b : x.a)),
      )
    : new Set<string>();
  const names = new Map(
    (others.length ? await db.select().from(users).where(inArray(users.id, others)) : []).map((u) => [u.id, displayName(profileOf(u))]),
  );
  /** Named, unless they are 触须之交 no more */
  const named = (id: string): RecordWho => (friendsNow.has(id) ? { name: names.get(id) ?? "" } : cut.has(id) ? { ex: true } : names.has(id) ? { name: names.get(id)! } : null);

  // touches sent: which were answered, and how
  const sentIds = page.filter((r) => r.src === "to").map((r) => r.id);
  const answers = sentIds.length
    ? await db
        .select({ replyTo: touches.replyTo, bold: touches.bold })
        .from(touches)
        .where(and(eq(touches.toUserId, me), eq(touches.withheld, false), inArray(touches.replyTo, sentIds.map((id) => `t:${id}`))))
    : [];
  const answerOf = new Map(answers.map((a) => [a.replyTo!.slice(2), a.bold ? ("bold" as const) : ("sneaky" as const)]));
  // touches answered by a touch sent: whether that one was bold, which named its sender
  const answeredIds = page
    .filter((r) => r.src === "to")
    .map((r) => (r.item as { replyTo?: string | null }).replyTo)
    .filter((x): x is string => Boolean(x?.startsWith("t:")))
    .map((x) => x.slice(2));
  const boldOnes = new Set(
    answeredIds.length
      ? (
          await db
            .select({ id: touches.id })
            .from(touches)
            .where(and(inArray(touches.id, answeredIds), eq(touches.bold, true)))
        ).map((t) => t.id)
      : [],
  );
  // touches got: which were touched back, and how
  const gotIds = page.filter((r) => r.src === "ti").map((r) => r.id);
  const mine = gotIds.length
    ? await db
        .select({ replyTo: touches.replyTo, bold: touches.bold })
        .from(touches)
        .where(and(eq(touches.fromUserId, me), inArray(touches.replyTo, gotIds.map((id) => `t:${id}`))))
    : [];
  const mineOf = new Map(mine.map((a) => [a.replyTo!.slice(2), a.bold ? ("bold" as const) : ("sneaky" as const)]));
  // the reactions each declaration got, by their words (never who)
  const declIds = page.filter((r) => r.src === "de" || r.src === "rx").map((r) => r.id);
  const blocked = [...(await blockedBy(me))];
  const reacted = declIds.length
    ? await db
        .select({ declarationId: reactions.declarationId, reaction: reactions.reaction, d: declarations })
        .from(reactions)
        .innerJoin(declarations, eq(declarations.id, reactions.declarationId))
        .where(and(inArray(reactions.declarationId, declIds), eq(reactions.withheld, false), blocked.length ? not(inArray(reactions.fromUserId, blocked)) : undefined))
    : [];
  const rxOf = new Map<string, Map<string, number>>();
  for (const r of reacted) {
    const words = replyOf(storedDeclaration(r.d), r.reaction)?.text;
    if (!words) continue;
    const m = rxOf.get(r.declarationId) ?? new Map<string, number>();
    m.set(words, (m.get(words) ?? 0) + 1);
    rxOf.set(r.declarationId, m);
  }
  const rxList = (id: string): [string, number][] => [...(rxOf.get(id) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  // from how many roaches a declaration went, while that is still kept
  const spots = declIds.length
    ? new Map(
        (
          await db
            .select({ id: declarationSpots.declarationId, n: count() })
            .from(declarationSpots)
            .where(inArray(declarationSpots.declarationId, declIds))
            .groupBy(declarationSpots.declarationId)
        ).map((s) => [s.id, s.n]),
      )
    : new Map<string, number>();

  return page.map((r): TimelineItem => {
    const base = { key: `${r.us}|${r.src}|${r.id}`, at: Math.floor(Number(BigInt(r.us) / 1000n)), cat: r.cat, dir: r.dir };
    const item = r.item as Record<string, unknown>;
    switch (item.kind) {
      case "tout": {
        const { replyTo, ...rest } = item as { replyTo: string | null } & Record<string, unknown>;
        const got = answerOf.get(r.id) ?? null;
        const since = friendsNow.get(r.other!);
        const at = base.at;
        // known: a 触须之交 then, one who boldly touched this back, or the bold one this touched back
        const known = (since !== undefined && since <= at) || got === "bold" || Boolean(replyTo?.startsWith("t:") && boldOnes.has(replyTo.slice(2)));
        return { ...base, ...(rest as object), got, who: known ? named(r.other!) : null } as TimelineItem;
      }
      case "tin": {
        const touched = mineOf.get(r.id);
        return {
          ...base,
          ...(item as object),
          mine: touched ?? (item.mine as "ignored" | null),
          // a sneaky one never says who, 触须之交 or not
          who: item.bold ? named(r.other!) : null,
        } as TimelineItem;
      }
      case "decl":
        return { ...base, ...(item as object), rx: rxList(r.id), roaches: spots.get(r.id) ?? null } as TimelineItem;
      case "rxin":
        return { ...base, ...(item as object), rx: rxList(r.id) } as TimelineItem;
      case "friend":
      case "note":
      case "poke":
        return { ...base, ...(item as object), who: named(r.other!) } as TimelineItem;
      default:
        return { ...base, ...(item as object) } as TimelineItem;
    }
  });
}
