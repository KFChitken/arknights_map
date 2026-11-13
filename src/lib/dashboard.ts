import type { AppCountDay } from "./appCounts";
import type { GuideId } from "./guides";
import type { RetentionStats } from "./safety";

/**
 * The 管理台's 数据看板 (src/components/admin/Dashboard.tsx), the owner's alone: what its endpoint answers
 * (src/lib/server/dashboard.ts) and the names it counts by (src/lib/server/stats.ts). Totals only: nothing here
 * points at a player, and every name is a code the page puts into words.
 */

/** The site's first Beijing day: the board's days start here */
export const OPEN_DAY = "2026-10-22";

/** The how-manieth player a milestone is, shown when reached and the next one as still to come */
export const MILESTONES = [10_000, 50_000, 100_000, 200_000, 500_000, 1_000_000] as const;

/** What 触须之交 do for each other, as counted (note.<kind>) and ranked; the notes the site writes itself are not */
export const NOTE_KINDS = ["hug", "highfive", "luck", "sanity", "visit", "blanket", "water", "gameAsk", "gameWant"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const isNoteKind = (k: unknown): k is NoteKind => (NOTE_KINDS as readonly unknown[]).includes(k);

/**
 * The day's counters (stat_counts.name), each counted as the row it stands for is written:
 * - touch.sneaky, touch.bold: a touch of a player's roach (an ink roach's too) or touching one back; touch.back: one
 *   that answers a touch; touch.ignored: 默默爬走 from a touch
 * - decl: a declaration, decl.<template> by its sentence (a limited one is decl.event), decl.reach: the players it reached
 * - reply: a reply left on a declaration, reply.<id> by the reply (love.1, zhouli…)
 * - note.<kind>: one of NOTE_KINDS
 * - place.main, place.clone, place.ink: a new roach on the map (a move is none), 墨小强 as 祀掌柜 draws it
 * - guide.<id>: a player's touch of a guide
 * Written only by the one-time backfill (src/lib/server/dashboard.ts), for the days before daily_totals was kept:
 * - signups, friendships: accounts made and pairs who became 触须之交 that day, of those still there
 * - backfill.done (on OPEN_DAY): when the backfill ran, so it runs once
 */
export const COUNTED = {
  sneaky: "touch.sneaky",
  bold: "touch.bold",
  back: "touch.back",
  ignored: "touch.ignored",
  decl: "decl",
  reach: "decl.reach",
  reply: "reply",
  main: "place.main",
  clone: "place.clone",
  ink: "place.ink",
  signups: "signups",
  friendships: "friendships",
  backfilled: "backfill.done",
} as const;
export const declName = (template: string) => `decl.${template}`;
export const replyName = (id: string) => `reply.${id}`;
export const noteName = (kind: NoteKind) => `note.${kind}`;
export const guideName = (id: GuideId) => `guide.${id}`;

/**
 * The big cities 地图上哪里最多 counts main roaches around (within CITY_KM of the centre, each roach for the
 * nearest), by code: the page puts them into words (src/components/admin/dashWords.ts)
 */
export const CITIES = [
  { id: "shanghai", lng: 121.4737, lat: 31.2304 },
  { id: "beijing", lng: 116.4074, lat: 39.9042 },
  { id: "guangzhou", lng: 113.2644, lat: 23.1291 },
  { id: "shenzhen", lng: 114.0579, lat: 22.5431 },
  { id: "chengdu", lng: 104.0665, lat: 30.5723 },
  { id: "hangzhou", lng: 120.1551, lat: 30.2741 },
  { id: "chongqing", lng: 106.5516, lat: 29.563 },
  { id: "wuhan", lng: 114.3054, lat: 30.5931 },
  { id: "nanjing", lng: 118.7969, lat: 32.0603 },
  { id: "xian", lng: 108.9398, lat: 34.3416 },
  { id: "tianjin", lng: 117.201, lat: 39.0842 },
  { id: "suzhou", lng: 120.5853, lat: 31.2989 },
  { id: "changsha", lng: 112.9388, lat: 28.2282 },
  { id: "zhengzhou", lng: 113.6254, lat: 34.7466 },
  { id: "shenyang", lng: 123.4315, lat: 41.8057 },
  { id: "qingdao", lng: 120.3826, lat: 36.0671 },
  { id: "jinan", lng: 117.1205, lat: 36.6519 },
  { id: "hefei", lng: 117.2272, lat: 31.8206 },
  { id: "fuzhou", lng: 119.2965, lat: 26.0745 },
  { id: "xiamen", lng: 118.0894, lat: 24.4798 },
  { id: "kunming", lng: 102.8329, lat: 24.8801 },
  { id: "harbin", lng: 126.535, lat: 45.8038 },
  { id: "dalian", lng: 121.6147, lat: 38.914 },
  { id: "nanning", lng: 108.3669, lat: 22.817 },
  { id: "hongkong", lng: 114.1694, lat: 22.3193 },
  { id: "taipei", lng: 121.5654, lat: 25.033 },
  { id: "tokyo", lng: 139.6917, lat: 35.6895 },
  { id: "seoul", lng: 126.978, lat: 37.5665 },
  { id: "singapore", lng: 103.8198, lat: 1.3521 },
  { id: "kualalumpur", lng: 101.6869, lat: 3.139 },
  { id: "sydney", lng: 151.2093, lat: -33.8688 },
  { id: "losangeles", lng: -118.2437, lat: 34.0522 },
  { id: "newyork", lng: -74.006, lat: 40.7128 },
  { id: "london", lng: -0.1276, lat: 51.5072 },
] as const;
export type CityId = (typeof CITIES)[number]["id"];
export const CITY_KM = 40;

/** A count of something: what it is (a code, or an operator's name), and how many */
export type Count = { key: string; n: number };

/** A best day: how many, and on which Beijing day (YYYY-MM-DD) */
export type BestDay = { n: number; day: string };

/** One Beijing day of the board's charts, oldest first */
export type DashDay = {
  day: string;
  /** Accounts made, and pairs who became 触须之交 (from the 10-minute totals) */
  signups: number;
  friendships: number;
  /** Real accounts at the day's end (today: now); null on the days before the board kept it */
  players: number | null;
  /** New roaches: main ones, clones and ink roaches */
  placed: number;
  sneaky: number;
  bold: number;
  decl: number;
  replies: number;
  /** Players who came that day, and the most online at once: null on the days before the board kept them */
  visitors: number | null;
  peakOnline: number | null;
};

/**
 * What the board counts once a day, at 05:00 Beijing time (stat_snapshots): how the players and their roaches are
 * spread, rankings and badges. Counts and codes only.
 */
export type StatSnapshot = {
  /** Real accounts then */
  players: number;
  /** When the MILESTONES reached were, among the accounts there are now */
  milestones: { n: number; at: number }[];
  /** By look (ROACH_AVATARS), most first */
  avatars: Count[];
  /** By colour, among those who wear the hood, the only look that shows it; and how many wear it */
  colors: Count[];
  hood: number;
  /** Which games they said they play */
  games: { arknights: number; endfield: number; both: number; none: number };
  /** Players with a clone out, clones in all, players with every clone out, and clones riding with 明河都尉 */
  clones: { players: number; all: number; full: number; riders: number };
  /** The ten most named of each list, by operator name */
  favourites: { arknights: Count[]; endfield: Count[]; support: Count[] };
  /**
   * 触须之交 now: pairs, players with any, the most one player has (how many, never who), and how many days the
   * oldest pair has lasted
   */
  friendships: { pairs: number; withSome: number; most: number; oldestDays: number | null };
  /** Badges held, by badge, and in all */
  badges: { total: number; by: Count[] };
  /** Each guide's 触须之交; 墨小强 that had a room at 缘缘庄, and those waiting for one */
  guides: { friends: Record<GuideId, number>; inksStayed: number; inksQueued: number };
  /** Main roaches in China (as China's standard map draws it) and elsewhere, and around the biggest cities */
  where: { china: number; abroad: number; cities: Count[] };
  /** The most players one declaration ever reached, and the day */
  reach: BestDay | null;
};

/** What the board is sent, every minute while it is open */
export type DashboardData = {
  asOf: number;
  /** The days before the board have been filled in from what the site kept (the first 05:00 after it went up) */
  backfilled: boolean;
  /** The first days with players who came, and with players online, which start with the board */
  since: { visitors: string | null; online: string | null };
  totals: {
    players: number;
    /** On the map now: main roaches, clones, ink roaches; by 塔露拉干员's fire and riding with 明河都尉 */
    roaches: { mains: number; clones: number; inks: number; fire: number; riders: number };
    /** Pairs who became 触须之交 since the opening, those who parted later included */
    friendships: number;
    touches: { sneaky: number; bold: number };
    decl: number;
    replies: number;
    /** Each guide's touches by players, since the opening */
    guides: Record<GuideId, number>;
  };
  today: {
    day: string;
    /** Today's counters (COUNTED and the rest) */
    counts: Record<string, number>;
    /** Players online now (signed in, the page open), and the most at once today and when */
    online: number | null;
    peak: { n: number; at: number } | null;
  };
  /** Every day from OPEN_DAY to today */
  days: DashDay[];
  /** The most online at once in each hour, 0–23, today and yesterday; null where nothing was kept */
  hours: { today: (number | null)[]; yesterday: (number | null)[] };
  /** The 7 whole days before today: their counters added up */
  week: { from: string; to: string; counts: Record<string, number> };
  /** The latest of the 05:00 counts, and when it was made */
  snapshot: (StatSnapshot & { day: string; at: number }) | null;
  records: {
    online: { n: number; at: number } | null;
    signups: BestDay | null;
    friendships: BestDay | null;
    touches: BestDay | null;
    placed: BestDay | null;
    reach: BestDay | null;
  };
  /** 这周的人, as 网站和工具 had it: retention and 存到桌面's last 14 days */
  people: { retention: RetentionStats; desk: AppCountDay[] };
};
