import "server-only";
import { eq } from "drizzle-orm";
import { GRAY_MAX_DAYS, type GrayState } from "../adminConsole";
import { beijingDate } from "../beijing";
import { CAP_RANGE, LISTEN_DEFAULTS, ROOM_RANGE, type ListenSettings } from "../listen";
import { nextMemorial } from "../memorials";
import { FOLLOW_CODE_MAX, FOLLOW_NAME_MAX, followCode, type PassFollow } from "../passes";
import { db } from "./db";
import { HttpError } from "./http";
import { onReload, reloadEverywhere } from "./live";
import { siteSettings } from "./schema";
import { errorCode } from "./signals";

/**
 * Settings for the whole site that the owner changes in the 管理台 (site_settings), kept in memory by every process
 * and read before the first page asks (src/instrumentation-node.ts): a change reaches every process at once
 * (reloadEverywhere), and each reads them again every RELOAD_MS anyway: 全站变灰, until when everyone sees the site in
 * gray, for a national day of mourning; 听歌's (src/lib/server/listen.ts), paused or not, how many may listen at
 * once, how many to a room; 一起卫戍's (src/lib/server/squad.ts), closed for now or open, with the owner's line; and
 * 关注 B 站领券's (src/lib/server/passes.ts claimFollow), whose code changed is the old one refused at once. It lives
 * on globalThis because Next.js can load this module once per route bundle.
 */

/** 一起卫戍's (src/lib/server/squad.ts): closed for now (暂时关门, as when the game's season is between parts), with the owner's line for the list */
export type SquadSettings = { closed: boolean; note: string };
const SQUAD_DEFAULTS: SquadSettings = { closed: false, note: "" };
/** The owner's line, at most this long */
export const SQUAD_NOTE_MAX = 60;

/** 关注 B 站领券's: off, and nothing filled, until the owner fills it */
const PASS_FOLLOW_DEFAULTS: PassFollow = { on: false, name: "", url: "", code: "" };

type Held = {
  grayUntil: number | null;
  listen: ListenSettings;
  squad: SquadSettings;
  passFollow: PassFollow;
  loading: Promise<void> | null;
  again: boolean;
  started: boolean;
};
const g = globalThis as unknown as { siteSettingsHeld?: Held };
const held = (g.siteSettingsHeld ??= {
  grayUntil: null,
  listen: LISTEN_DEFAULTS,
  squad: SQUAD_DEFAULTS,
  passFollow: PASS_FOLLOW_DEFAULTS,
  loading: null,
  again: false,
  started: false,
});
held.listen ??= LISTEN_DEFAULTS;
held.squad ??= SQUAD_DEFAULTS;
held.passFollow ??= PASS_FOLLOW_DEFAULTS;
const RELOAD_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const GRAY = "gray";
const LISTEN = "listen";
const SQUAD = "squad";
const PASS_FOLLOW = "pass_follow";

/** gray's value: { until } as an ISO time; anything else is no gray at all */
function untilOf(value: unknown) {
  const until = value && typeof value === "object" ? Date.parse(String((value as { until?: unknown }).until)) : NaN;
  return Number.isFinite(until) ? until : null;
}

/** Read the settings again. Asked again meanwhile, it reads once more after, so the last change is never missed. */
export function loadSettings(): Promise<void> {
  if (held.loading) {
    held.again = true;
    return held.loading;
  }
  const loading = (async () => {
    try {
      do {
        held.again = false;
        const rows = await db.select({ key: siteSettings.key, value: siteSettings.value }).from(siteSettings);
        held.grayUntil = untilOf(rows.find((r) => r.key === GRAY)?.value);
        held.listen = listenOf(rows.find((r) => r.key === LISTEN)?.value);
        held.squad = squadOf(rows.find((r) => r.key === SQUAD)?.value);
        held.passFollow = passFollowOf(rows.find((r) => r.key === PASS_FOLLOW)?.value);
      } while (held.again);
    } finally {
      held.loading = null;
    }
  })();
  held.loading = loading;
  return loading;
}

// wherever this module is loaded, so the word from another process reaches it
onReload("settings", loadSettings);

/** At the start of every process (src/instrumentation-node.ts). Never throws: until they can be read, there is no gray. */
export async function startSettings() {
  if (held.started) return;
  held.started = true;
  setInterval(() => loadSettings().catch((e) => console.error("settings: reading them again failed", errorCode(e))), RELOAD_MS).unref();
  await loadSettings().catch((e) => console.error("settings: reading them failed, so there is no gray for now", errorCode(e)));
}

/** Until when the whole site is gray, or null when it is not (never set, ended, or past): from memory, never the database */
export const grayUntil = (now = Date.now()) => (held.grayUntil !== null && held.grayUntil > now ? held.grayUntil : null);

/** What 全站变灰 shows: whether the site is gray now and until when, and the next day of remembrance */
export const grayState = (now = Date.now()): GrayState => ({ until: grayUntil(now), memorial: nextMemorial(beijingDate(now)) });

const GRAY_WHEN = `恢复时间要在现在到 ${GRAY_MAX_DAYS} 天以内。`;

/**
 * Gray for everyone until a moment (ms) between now and GRAY_MAX_DAYS ahead, set by byId: on every process at once,
 * and on the pages open within 2 minutes. Says until when, as kept.
 */
export async function setGray(byId: string, until: unknown, now = Date.now()) {
  const t = typeof until === "number" ? Math.floor(until) : NaN;
  if (!Number.isFinite(t) || t <= now || t > now + GRAY_MAX_DAYS * DAY_MS) throw new HttpError(400, GRAY_WHEN);
  const set = { value: { until: new Date(t).toISOString() }, updatedAt: new Date(now), updatedBy: byId };
  await db
    .insert(siteSettings)
    .values({ key: GRAY, ...set })
    .onConflictDoUpdate({ target: siteSettings.key, set });
  await reloadEverywhere("settings");
  return t;
}

/** Colour again for everyone, before the time set. Says whether the site was gray till then. */
export async function endGray(now = Date.now()) {
  const gone = await db.delete(siteSettings).where(eq(siteSettings.key, GRAY)).returning({ value: siteSettings.value });
  await reloadEverywhere("settings");
  return gone.some((r) => (untilOf(r.value) ?? 0) > now);
}

// ---- 听歌 ----

const within = (n: unknown, [lo, hi]: readonly [number, number]): n is number => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;

/** listen's value: { paused, cap, roomMax }, each its default where it is missing or makes no sense */
function listenOf(value: unknown): ListenSettings {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    paused: v.paused === true,
    cap: within(v.cap, CAP_RANGE) ? v.cap : LISTEN_DEFAULTS.cap,
    roomMax: within(v.roomMax, ROOM_RANGE) ? v.roomMax : LISTEN_DEFAULTS.roomMax,
  };
}

/** 听歌's settings now: from memory, never the database */
export const listenSettings = (): ListenSettings => held.listen;

/**
 * Some of 听歌's settings changed by byId (the owner): paused, cap, roomMax, each only if given. On every process at
 * once. Says what they are now.
 */
export async function setListen(byId: string, change: unknown, now = Date.now()): Promise<ListenSettings> {
  const c = change && typeof change === "object" ? (change as Record<string, unknown>) : {};
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, LISTEN));
  const next = listenOf(row?.value);
  if ("paused" in c) {
    if (typeof c.paused !== "boolean") throw new HttpError(400, "暂停听歌只能开或关。");
    next.paused = c.paused;
  }
  if ("cap" in c) {
    if (!within(c.cap, CAP_RANGE)) throw new HttpError(400, `同时在听上限要是 ${CAP_RANGE[0]} 到 ${CAP_RANGE[1]} 之间的整数。`);
    next.cap = c.cap;
  }
  if ("roomMax" in c) {
    if (!within(c.roomMax, ROOM_RANGE)) throw new HttpError(400, `一场最多几人要是 ${ROOM_RANGE[0]} 到 ${ROOM_RANGE[1]} 之间的整数。`);
    next.roomMax = c.roomMax;
  }
  const set = { value: next, updatedAt: new Date(now), updatedBy: byId };
  await db
    .insert(siteSettings)
    .values({ key: LISTEN, ...set })
    .onConflictDoUpdate({ target: siteSettings.key, set });
  await reloadEverywhere("settings");
  return next;
}

// ---- 一起卫戍 ----

/** squad's value: { closed, note }, each its default where it is missing or makes no sense */
function squadOf(value: unknown): SquadSettings {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    closed: v.closed === true,
    note: typeof v.note === "string" ? v.note.trim().slice(0, SQUAD_NOTE_MAX) : "",
  };
}

/** 一起卫戍's settings now: from memory, never the database */
export const squadSettings = (): SquadSettings => held.squad;

/**
 * 一起卫戍 closed for now or open again (closed), and the owner's line the list shows while it is closed (note), each
 * only if given, by byId (the owner). On every process at once. Says what they are now; the caller ends the rooms.
 */
export async function setSquad(byId: string, change: unknown, now = Date.now()): Promise<SquadSettings> {
  const c = change && typeof change === "object" ? (change as Record<string, unknown>) : {};
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, SQUAD));
  const next = squadOf(row?.value);
  if ("closed" in c) {
    if (typeof c.closed !== "boolean") throw new HttpError(400, "暂时关门只能开或关。");
    next.closed = c.closed;
  }
  if ("note" in c) {
    if (typeof c.note !== "string") throw new HttpError(400, "提示要是一句话。");
    const note = c.note.trim();
    if (note.length > SQUAD_NOTE_MAX) throw new HttpError(400, `提示最多 ${SQUAD_NOTE_MAX} 个字。`);
    next.note = note;
  }
  const set = { value: next, updatedAt: new Date(now), updatedBy: byId };
  await db
    .insert(siteSettings)
    .values({ key: SQUAD, ...set })
    .onConflictDoUpdate({ target: siteSettings.key, set });
  await reloadEverywhere("settings");
  return next;
}

// ---- 关注 B 站领券 (通行证寻访) ----

/** A link to a B 站 page: https, on bilibili.com (space.bilibili.com/…, m.bilibili.com/…) or its short links, b23.tv */
export function isBilibiliUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && !u.username && !u.password && (host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv");
  } catch {
    return false;
  }
}

/** pass_follow's value: { on, name, url, code }, each as it may be kept, else as if never filled */
function passFollowOf(value: unknown): PassFollow {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const name = typeof v.name === "string" ? v.name.trim() : "";
  const url = typeof v.url === "string" ? v.url.trim() : "";
  const code = typeof v.code === "string" ? followCode(v.code) : "";
  return {
    on: v.on === true,
    name: name.length <= FOLLOW_NAME_MAX ? name : "",
    url: isBilibiliUrl(url) ? url : "",
    code: code.length <= FOLLOW_CODE_MAX ? code : "",
  };
}

/** 关注 B 站领券's settings now, the code too, for the server and the 管理台 alone: from memory, never the database */
export const passFollow = (): PassFollow => held.passFollow;

/** Whether 寻访 shows the task: on, with the account, its link and a code all filled */
export const followShown = (f: PassFollow) => f.on && Boolean(f.name && f.url && f.code);

/**
 * 关注 B 站领券 changed by byId (the owner): on, name, url, code, each only if given (the code as it is compared:
 * no spaces, capitals). On every process at once, so an old code is refused from then on everywhere. Says what they
 * are now.
 */
export async function setPassFollow(byId: string, change: unknown, now = Date.now()): Promise<PassFollow> {
  const c = change && typeof change === "object" ? (change as Record<string, unknown>) : {};
  const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, PASS_FOLLOW));
  const next = passFollowOf(row?.value);
  if ("on" in c) {
    if (typeof c.on !== "boolean") throw new HttpError(400, "开关只能开或关。");
    next.on = c.on;
  }
  if ("name" in c) {
    const name = typeof c.name === "string" ? c.name.trim() : null;
    if (name === null || name.length > FOLLOW_NAME_MAX) throw new HttpError(400, `账号最多 ${FOLLOW_NAME_MAX} 个字。`);
    next.name = name;
  }
  if ("url" in c) {
    const url = typeof c.url === "string" ? c.url.trim() : null;
    if (url === null || (url && !isBilibiliUrl(url))) throw new HttpError(400, "链接要是 B 站的 https 链接，比如 https://space.bilibili.com/…，或者 https://b23.tv/…。");
    next.url = url;
  }
  if ("code" in c) {
    const code = typeof c.code === "string" ? followCode(c.code) : null;
    if (code === null || code.length > FOLLOW_CODE_MAX) throw new HttpError(400, `口令最多 ${FOLLOW_CODE_MAX} 个字，空格不算。`);
    next.code = code;
  }
  const set = { value: next, updatedAt: new Date(now), updatedBy: byId };
  await db
    .insert(siteSettings)
    .values({ key: PASS_FOLLOW, ...set })
    .onConflictDoUpdate({ target: siteSettings.key, set });
  await reloadEverywhere("settings");
  return next;
}
