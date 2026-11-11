import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { LngLat } from "../types";
import { DECLARATION_DAYS, DECLARATION_RADIUS_KM, INBOX_DAYS, INBOX_DECLARATIONS } from "../rules";
import { db } from "./db";
import { declarations, declarationSpots, deliveries, users } from "./schema";

/**
 * Which declarations a player sees in 消息. A declaration is kept once, with the spots of the roaches it was
 * sent from (declaration_spots, kept DECLARATION_DAYS), not a row for everyone it reached. A player sees:
 *   a. any sent in the last DECLARATION_DAYS within DECLARATION_RADIUS_KM of one of their roaches now
 *      (main, clones, visiting or riding with 明河都尉): moving a roach near shows them, moving it away
 *      hides them;
 *   b. any they reacted to or touched back, within INBOX_DAYS, wherever their roaches are now;
 *   c. a 「祝我生日快乐」 sent to them as a 触须之交 (a delivery row with to_friend), within INBOX_DAYS;
 *   and, the week after declarations started keeping their spots, any delivered to them the old way.
 * Never their own, nor any between players who blocked one another. Read: a delivery row's seen_at,
 * else whether it is no newer than users.declarations_seen_at, so old ones a move brings in come read.
 *
 * Finding a: the spots are kept by square of the map (0.1° each way) and time, so only the squares within
 * reach of the player's roaches are read, each newest first, stopping at the hundredth near enough: where
 * many are sent that is a few hours' worth, where few are the whole week of a few squares, little either
 * way. Distances are on a sphere, as the crow flies (within a few metres of PostGIS's at 10 km). All of it,
 * the blocks, what was answered and delivered included, is one statement after the player's roaches.
 */

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A degree of a great circle, in km (the mean Earth radius, 6371 km) */
const KM_PER_DEG = 111.195;
/** A square of the map: this many degrees of latitude and of longitude */
export const SPOT_CELL_DEG = 0.1;
const COLUMNS = Math.round(360 / SPOT_CELL_DEG);
const ROWS = Math.round(180 / SPOT_CELL_DEG);

const columnOf = (lng: number) => (((Math.floor((lng + 180) / SPOT_CELL_DEG + 1e-9) % COLUMNS) + COLUMNS) % COLUMNS);
const rowOf = (lat: number) => Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / SPOT_CELL_DEG + 1e-9)));

/** The square of the map a spot is in */
export const spotCell = (p: LngLat) => rowOf(p.lat) * COLUMNS + columnOf(p.lng);

/** Every square a circle of `km` around any of the places reaches into */
export function cellsNear(places: LngLat[], km = DECLARATION_RADIUS_KM): number[] {
  const cells = new Set<number>();
  for (const p of places) {
    const dLat = km / KM_PER_DEG;
    const dLng = Math.min(180, km / (KM_PER_DEG * Math.max(0.01, Math.cos((Math.min(89, Math.abs(p.lat)) * Math.PI) / 180))));
    const across = Math.min(COLUMNS - 1, Math.floor((p.lng + dLng + 180) / SPOT_CELL_DEG + 1e-9) - Math.floor((p.lng - dLng + 180) / SPOT_CELL_DEG + 1e-9));
    for (let row = rowOf(p.lat - dLat); row <= rowOf(p.lat + dLat); row++) {
      const first = columnOf(p.lng - dLng);
      for (let i = 0; i <= across; i++) cells.add(row * COLUMNS + ((first + i) % COLUMNS));
    }
  }
  return [...cells];
}

/** A Postgres array of uuids, as one parameter */
const uuidArray = (ids: Iterable<string>) => `{${[...ids].filter((id) => UUID.test(id)).join(",")}}`;

/** The rows a declaration's spots are kept in (one for each roach it was sent from) */
export const spotRows = (d: { id: string; senderId: string; createdAt: Date }, from: LngLat[]) =>
  from.map((p, spot) => ({ declarationId: d.id, spot, cell: spotCell(p), lng: p.lng, lat: p.lat, senderId: d.senderId, createdAt: d.createdAt }));

export type SeenDeclaration = { d: typeof declarations.$inferSelect; seen: boolean; toFriend: boolean };

/** A declaration as the query below gives it, its columns as Postgres names them */
type Row = {
  id: string;
  sender_id: string;
  template: string;
  game: string | null;
  character: string | null;
  title: string | null;
  food: string | null;
  name: string | null;
  held_name: string | null;
  line: string | null;
  recipients: number;
  created_at: string | Date;
  seen: boolean;
  to_friend: boolean;
};

const seenOf = (r: Row): SeenDeclaration => ({
  d: {
    id: r.id,
    senderId: r.sender_id,
    template: r.template,
    game: r.game,
    character: r.character,
    title: r.title,
    food: r.food,
    name: r.name,
    heldName: r.held_name,
    line: r.line,
    recipients: Number(r.recipients),
    createdAt: new Date(r.created_at),
  },
  seen: Boolean(r.seen),
  toFriend: Boolean(r.to_friend),
});

/** The time slices a look around reads, from now back, until it has \`limit\`: most places need only the first */
const SLICES_MS = [6 * 3_600_000, 2 * DAY, DECLARATION_DAYS * DAY];

/**
 * The declarations a player sees (as above), newest first, at most `limit`, sent after `after`;
 * with `ids`, only those of them. The limit is applied in the database, after leaving out the blocked.
 */
export async function visibleDeclarations(
  userId: string,
  opts: { after?: Date; ids?: string[]; limit?: number } = {},
  now = Date.now(),
): Promise<SeenDeclaration[]> {
  if (!UUID.test(userId) || (opts.ids && !opts.ids.length)) return [];
  const limit = opts.limit ?? INBOX_DECLARATIONS;
  const after = opts.after?.getTime() ?? 0;
  const localFrom = Math.max(now - DECLARATION_DAYS * DAY, after);
  const localSince = new Date(localFrom).toISOString();
  const inboxSince = new Date(Math.max(now - INBOX_DAYS * DAY, after)).toISOString();
  // the player's roaches, and when spots began (or, once a week has gone by, about a week ago): anything sent before has none
  const [start] = await db.execute<{ places: [number, number][] | string; first: string | null }>(sql`
    select coalesce(json_agg(json_build_array(r.lng, r.lat)), '[]'::json) as places,
      (select min(created_at) from declaration_spots) as first
    from roaches r where r.user_id = ${userId}`);
  const places = (typeof start.places === "string" ? (JSON.parse(start.places) as [number, number][]) : start.places).map(([lng, lat]) => ({ lng, lat }));
  const spotsFrom = start.first ? new Date(start.first).getTime() : Infinity;
  const ids = opts.ids ? uuidArray(opts.ids) : null;
  // a. near one of the player's roaches: within reach on a sphere, flat over 10 km, across ±180° too
  const lngs = `{${places.map((p) => p.lng).join(",")}}`;
  const lats = `{${places.map((p) => p.lat).join(",")}}`;
  const near = sql`exists (
    select 1 from unnest(${lngs}::float8[], ${lats}::float8[]) m(lng, lat)
    where power((s.lat - m.lat) * ${KM_PER_DEG}::float8, 2)
      + power(least(abs(s.lng - m.lng), 360 - abs(s.lng - m.lng)) * ${KM_PER_DEG}::float8 * cos(radians((s.lat + m.lat) / 2)), 2)
      <= ${DECLARATION_RADIUS_KM ** 2}::float8)`;
  const fromOthers = sql`s.sender_id <> ${userId} and s.sender_id not in (select id from blocked)`;
  const cells = `{${cellsNear(places).join(",")}}`;
  // Delivered the old way (any delivery row but a birthday's) means sent before spots began, so older than every
  // declaration found by its spots: none can be among the newest once \`limit\` of those are found, nor sent
  // after a time since spots began (the page's ask for what is new). Only then are the player's rows looked up.
  const needOld = ids
    ? sql`true`
    : sql`(select count(*) from local) < ${limit}::int and ${localFrom < spotsFrom}::boolean`;

  /** Everything, with the spots read from `from` (a slice: enough only if \`limit\` are found) */
  const inbox = (from: number) => {
    const local = !places.length
      ? sql`select null::uuid as id, null::timestamptz as at where false`
      : sql`select s.declaration_id as id, max(s.created_at) as at from declaration_spots s
          where ${ids ? sql`s.declaration_id = any(${ids}::uuid[])` : sql`s.cell = any(${cells}::int[])`}
            and s.created_at > ${new Date(from).toISOString()}::timestamptz and ${fromOthers} and ${near}
          group by s.declaration_id
          order by at desc
          limit ${limit}::int`;
    return db.execute<Row & { local_n: number }>(sql`
      with blocked as (
        select blocked_id as id from blocks where blocker_id = ${userId}
        union select blocker_id from blocks where blocked_id = ${userId}
      ),
      local as (${local}),
      need_old as (select ${needOld} as yes),
      answered as (
        select declaration_id as id from declaration_reactions
        where from_user_id = ${userId} and created_at > ${inboxSince}::timestamptz
        union
        select substring(reply_to from 3)::uuid from touches
        where from_user_id = ${userId} and created_at > ${inboxSince}::timestamptz and reply_to ~ '^d:[0-9a-f-]{36}$'
      ),
      delivered as (
        -- birthdays of 触须之交, and the week after spots began, those delivered the old way: only the newest
        -- \`limit\` of them can be among the newest \`limit\` of all. From the player's own rows, each looked up
        -- by its id (offset 0 keeps the lookup apart): left to itself, Postgres walked every declaration newest
        -- first, or read them all to join them at once
        select dv.declaration_id as id
        from declaration_deliveries dv
        cross join lateral (select x.created_at from declarations x where x.id = dv.declaration_id offset 0) d
        where dv.recipient_id = ${userId} ${ids ? sql`and dv.declaration_id = any(${ids}::uuid[])` : sql``}
          and (dv.to_friend or (select yes from need_old))
          and d.created_at > ${inboxSince}::timestamptz and (dv.to_friend or d.created_at > ${localSince}::timestamptz)
        order by d.created_at desc
        limit ${limit}::int
      ),
      candidates as (
        select id, bool_or(near) as near from (
          select id, true as near from local
          union all select id, false from answered
          union all select id, false from delivered
        ) x group by id
      )
      select d.id, d.sender_id, d.template, d.game, d.character, d.title, d.food, d.name, d.held_name, d.line, d.recipients, d.created_at,
        case when dv.declaration_id is not null then dv.seen_at is not null
          else coalesce(d.created_at <= u.declarations_seen_at, false) end as seen,
        coalesce(dv.to_friend, false) as to_friend,
        (select count(*) from local)::int as local_n
      from candidates c
      join declarations d on d.id = c.id
      join users u on u.id = ${userId}
      left join declaration_deliveries dv on dv.declaration_id = d.id and dv.recipient_id = ${userId}
      where d.sender_id <> ${userId}
        and d.created_at > ${inboxSince}::timestamptz
        and d.sender_id not in (select id from blocked)
        ${ids ? sql`and d.id = any(${ids}::uuid[])` : sql``}
        and (not c.near or d.created_at > ${localSince}::timestamptz)
      order by d.created_at desc, d.id
      limit ${limit}::int`);
  };

  let rows: (Row & { local_n: number })[] = [];
  for (const back of ids ? [Infinity] : SLICES_MS) {
    const from = Math.max(localFrom, now - back);
    rows = await inbox(from);
    // enough found near, or every one since localFrom read, or every spot there is
    if ((rows[0]?.local_n ?? 0) >= limit || from === localFrom || from <= spotsFrom) break;
  }
  return rows.map(seenOf);
}

/** Whether the player sees this declaration now (reacting, touching back and reporting ask) */
export async function canSeeDeclaration(userId: string, id: string, now = Date.now()) {
  return (await visibleDeclarations(userId, { ids: [id], limit: 1 }, now))[0]?.d ?? null;
}

/**
 * 消息 opened on these declarations: delivery rows are marked as before, and the player has read up to
 * the newest of them they see.
 */
export async function seeDeclarations(userId: string, ids: string[], now = Date.now()) {
  const valid = [...new Set(ids.filter((i) => UUID.test(i)))];
  if (!valid.length) return;
  const at = new Date(now);
  await db
    .update(deliveries)
    .set({ seenAt: at })
    .where(and(inArray(deliveries.declarationId, valid), eq(deliveries.recipientId, userId), isNull(deliveries.seenAt)));
  const seen = await visibleDeclarations(userId, { ids: valid, limit: valid.length }, now);
  if (!seen.length) return;
  // the newest one's own time, to the microsecond (a JavaScript date would stop at the millisecond)
  const newest = sql`(select max(${declarations.createdAt}) from ${declarations} where ${declarations.id} = any(${uuidArray(seen.map((x) => x.d.id))}::uuid[]))`;
  await db
    .update(users)
    .set({ declarationsSeenAt: sql`greatest(${users.declarationsSeenAt}, ${newest})` })
    .where(eq(users.id, userId));
}

/** Spots older than DECLARATION_DAYS show to nobody any more: forget where they were sent from (retention.ts) */
export async function forgetOldSpots(now = Date.now()) {
  await db.delete(declarationSpots).where(lt(declarationSpots.createdAt, new Date(now - DECLARATION_DAYS * DAY)));
}
