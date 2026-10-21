import { declarationText, type Declaration } from "../declarations";
import { distanceKm, fuzz } from "../fuzz";
import { GAMES, isGame, type Game } from "../games";
import { isOperator } from "../operators";
import { displayName, EMPTY_PROFILE, type Profile, type PublicProfile } from "../profile";
import { hash128 } from "../prng";
import {
  DECLARATION_COOLDOWN_MIN,
  DECLARATION_RADIUS_KM,
  DECLARATIONS_PER_DAY,
  FUZZ_CELL_KM,
  INBOX_DAYS,
  MAX_CLONES,
  MAX_FAVOURITES,
  NAME_MAX,
  TOUCH_SAME_ROACH_HOURS,
  TOUCHES_PER_DAY,
  UID_MAX,
} from "../rules";
import { titlesFor } from "../titles";
import { ROACH_COLORS, type LngLat, type RoachColor } from "../types";
import { passerbyIndex, passerbyProfile, passersby, TESTERS } from "./cast";
import {
  WorldError,
  type Friend,
  type FriendEvent,
  type Identity,
  type InboxItem,
  type Me,
  type OwnRoach,
  type PlaceTarget,
  type PlayerId,
  type PublicRoach,
  type TouchResult,
  type World,
} from "./types";

/**
 * World kept in this browser's localStorage. It applies the same privacy rules
 * a server would: other players' roaches come out fuzzed and in random order,
 * a touch never tells the toucher who owns the roach, and a declaration only
 * tells the sender a rough head count. Two players who have touched each other
 * boldly become 触须之交 and can see each other's roaches (still fuzzed) and activity.
 */

const KEY = "zhoup.world.v1";
const LEGACY_KEY = "zhoup.myRoach";
const ME: PlayerId = "me";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_DECLARATIONS_KEPT = 300;
const FRIEND_HISTORY = 30;
const CLONE_COLOR: RoachColor = "white";

type StoredRoach = LngLat & { id: string; owner: PlayerId; slot: number; pub: string };
type StoredTouch = {
  id: string;
  from: PlayerId;
  to: PlayerId;
  bold: boolean;
  /** Receiver's roach slot, null for a touch back */
  slot: number | null;
  /** Public id that was touched, for the once-a-day rule */
  pub: string | null;
  /** Inbox item this touch answers */
  re: string | null;
  at: number;
  seen?: number;
};
type StoredDeclaration = { id: string; from: PlayerId; d: Declaration; at: number; to: PlayerId[]; seen: PlayerId[] };
/** a and b are 触须之交 since at; seen lists who has been told */
type StoredFriendship = { a: PlayerId; b: PlayerId; at: number; seen: PlayerId[] };
type State = {
  v: 1;
  secret: string;
  current: PlayerId;
  profiles: Record<PlayerId, Profile>;
  roaches: StoredRoach[];
  /** Passers-by whose generated roach was replaced by stored ones */
  materialized: PlayerId[];
  touches: StoredTouch[];
  declarations: StoredDeclaration[];
  friendships: StoredFriendship[];
  /** When a pair last stopped being 触须之交; only touches after it count towards a new friendship */
  cuts: Record<string, number>;
};

/** A roach with both its true and its public position, as only this module sees it. */
type Placed = StoredRoach & { color: RoachColor; pubLng: number; pubLat: number };

function randomHex(bytes: number) {
  // crypto.randomUUID needs a secure context, which a phone on http://<LAN IP> is not
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

const pairKey = (a: PlayerId, b: PlayerId) => [a, b].sort().join("~");
const otherOf = (f: StoredFriendship, me: PlayerId) => (f.a === me ? f.b : f.a);

function hashHex(s: string) {
  return hash128(s)
    .slice(0, 2)
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
}

export class LocalWorld implements World {
  private st: State;
  private rev = 0;
  private placedCache: { rev: number; list: Placed[]; byPub: Map<string, Placed> } | null = null;
  private publicCache: { rev: number; viewer: PlayerId; list: PublicRoach[] } | null = null;
  private passerbyPub = new Map<string, { pub: string; pubLng: number; pubLat: number }>();

  constructor() {
    this.st = this.load();
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) {
        this.st = this.load();
        this.rev++;
      }
    });
  }

  // ---- storage ----

  private load(): State {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const st = JSON.parse(raw) as State;
        if (st.v === 1) {
          // fields added after the first local version
          st.friendships ??= [];
          st.cuts ??= {};
          return st;
        }
      }
    } catch {}
    const st = this.fresh();
    this.write(st);
    return st;
  }

  private fresh(importLegacy = true): State {
    const st: State = {
      v: 1,
      secret: randomHex(16),
      current: ME,
      profiles: {},
      roaches: [],
      materialized: [],
      touches: [],
      declarations: [],
      friendships: [],
      cuts: {},
    };
    for (const t of TESTERS) {
      st.profiles[t.id] = t.profile;
      t.roaches.forEach((p, slot) => st.roaches.push({ ...p, id: randomHex(8), owner: t.id, slot, pub: randomHex(8) }));
    }
    // Carry over the roach placed with the first prototype, once
    try {
      const old = importLegacy && JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
      if (old && Number.isFinite(old.lng) && Number.isFinite(old.lat)) {
        const color = ROACH_COLORS.includes(old.color) ? old.color : EMPTY_PROFILE.color;
        st.profiles[ME] = { ...EMPTY_PROFILE, color };
        st.roaches.push({ lng: old.lng, lat: old.lat, id: randomHex(8), owner: ME, slot: 0, pub: randomHex(8) });
      }
      localStorage.removeItem(LEGACY_KEY);
    } catch {}
    return st;
  }

  private write(st: State) {
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      // Storage full or blocked; keep working in memory
    }
  }

  private commit() {
    this.rev++;
    this.write(this.st);
  }

  // ---- lookups ----

  private profileOf(id: PlayerId): Profile {
    const saved = this.st.profiles[id];
    if (saved) return saved;
    const i = passerbyIndex(id);
    return i >= 0 ? passerbyProfile(passersby()[i]) : EMPTY_PROFILE;
  }

  private exists(id: PlayerId) {
    return id === ME || TESTERS.some((t) => t.id === id) || passerbyIndex(id) >= 0;
  }

  /** Every roach in the world with its public position. Passers-by are generated, the rest stored. */
  private placed() {
    if (this.placedCache?.rev === this.rev) return this.placedCache;
    const { secret } = this.st;
    const list: Placed[] = this.st.roaches.map((r) => {
      const pub = fuzz(r, `${r.owner}:${r.slot}`, secret, FUZZ_CELL_KM);
      return { ...r, color: this.profileOf(r.owner).color, pubLng: pub.lng, pubLat: pub.lat };
    });
    const materialized = new Set(this.st.materialized);
    for (const p of passersby()) {
      if (materialized.has(p.id)) continue;
      let cached = this.passerbyPub.get(p.id);
      if (!cached) {
        const at = fuzz(p, `${p.id}:0`, secret, FUZZ_CELL_KM);
        cached = { pub: hashHex(`${secret}|pub|${p.id}`), pubLng: at.lng, pubLat: at.lat };
        this.passerbyPub.set(p.id, cached);
      }
      const color = this.st.profiles[p.id]?.color ?? p.color;
      list.push({ lng: p.lng, lat: p.lat, id: `${p.id}-0`, owner: p.id, slot: 0, color, ...cached });
    }
    this.placedCache = { rev: this.rev, list, byPub: new Map(list.map((r) => [r.pub, r])) };
    return this.placedCache;
  }

  private ownRoaches(owner: PlayerId): OwnRoach[] {
    return this.placed()
      .list.filter((r) => r.owner === owner)
      .sort((a, b) => a.slot - b.slot)
      .map(({ id, slot, lng, lat }) => ({ id, slot, lng, lat }));
  }

  private publicProfile(id: PlayerId): PublicProfile {
    const p = this.profileOf(id);
    const uid: Partial<Record<Game, string>> = {};
    if (p.shareUid) for (const g of p.games) if (p.uid[g]) uid[g] = p.uid[g];
    return {
      displayName: displayName(p),
      games: p.games,
      favourites: { arknights: p.games.includes("arknights") ? p.favourites.arknights : [], endfield: p.games.includes("endfield") ? p.favourites.endfield : [] },
      uid: Object.keys(uid).length ? uid : undefined,
      color: p.color,
    };
  }

  /** Before a passer-by changes their roaches, turn the generated roach into a stored one. */
  private materialize(owner: PlayerId) {
    const i = passerbyIndex(owner);
    if (i < 0 || this.st.materialized.includes(owner)) return;
    const p = passersby()[i];
    this.st.materialized.push(owner);
    this.st.roaches.push({ lng: p.lng, lat: p.lat, id: randomHex(8), owner, slot: 0, pub: randomHex(8) });
    this.st.profiles[owner] ??= passerbyProfile(p);
  }

  private friendsOf(id: PlayerId) {
    return new Set(this.st.friendships.filter((f) => f.a === id || f.b === id).map((f) => otherOf(f, id)));
  }

  private friendId(other: PlayerId) {
    return hashHex(`${this.st.secret}|friend|${other}`);
  }

  /** After a bold touch from a to b: if b has also touched a boldly, they become 触须之交. */
  private befriendIfMutual(a: PlayerId, b: PlayerId, now: number): string | null {
    if (this.friendsOf(a).has(b)) return null;
    const cut = this.st.cuts[pairKey(a, b)] ?? 0;
    const bold = (x: PlayerId, y: PlayerId) => this.st.touches.some((t) => t.from === x && t.to === y && t.bold && t.at > cut);
    if (!bold(a, b) || !bold(b, a)) return null;
    this.st.friendships.push({ a, b, at: now, seen: [a] });
    return displayName(this.profileOf(b));
  }

  private replied(by: PlayerId, itemId: string) {
    return this.st.touches.some((t) => t.from === by && t.re === itemId);
  }

  private unseenCounts() {
    const counts = new Map<PlayerId, number>();
    const add = (id: PlayerId) => counts.set(id, (counts.get(id) ?? 0) + 1);
    const since = Date.now() - INBOX_DAYS * DAY;
    for (const t of this.st.touches) if (!t.seen && t.at > since) add(t.to);
    for (const d of this.st.declarations) {
      if (d.at <= since) continue;
      const seen = new Set(d.seen);
      for (const id of d.to) if (!seen.has(id)) add(id);
    }
    for (const f of this.st.friendships) for (const id of [f.a, f.b]) if (!f.seen.includes(id)) add(id);
    return counts;
  }

  // ---- World ----

  async me(): Promise<Me> {
    const id = this.st.current;
    return { id, profile: this.profileOf(id), roaches: this.ownRoaches(id) };
  }

  async roaches(): Promise<PublicRoach[]> {
    const viewer = this.st.current;
    const c = this.publicCache;
    if (c && c.rev === this.rev && c.viewer === viewer) return c.list;
    const friends = this.friendsOf(viewer);
    const list = this.placed()
      .list.filter((r) => r.owner !== viewer)
      .map((r) => this.publicRoach(r, friends.has(r.owner)))
      // ordering by the random public id keeps a player's roaches from sitting next to each other
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    this.publicCache = { rev: this.rev, viewer, list };
    return list;
  }

  private publicRoach(r: Placed, friend: boolean): PublicRoach {
    // clones all look alike, so a clone's color cannot point at its main roach
    const color = r.slot > 0 ? CLONE_COLOR : r.color;
    return { id: r.pub, clone: r.slot > 0, color, friend, lng: r.pubLng, lat: r.pubLat };
  }

  async saveProfile(input: Profile): Promise<Profile> {
    const name = input.name.trim().slice(0, NAME_MAX);
    const games = GAMES.filter((g) => input.games.includes(g));
    const favourites = { arknights: [] as string[], endfield: [] as string[] };
    const uid = { arknights: "", endfield: "" };
    for (const g of games) {
      favourites[g] = [...new Set(input.favourites[g])].filter((n) => isOperator(g, n)).slice(0, MAX_FAVOURITES);
      const u = input.uid[g].trim();
      if (u.length > UID_MAX || !/^[0-9A-Za-z#_-]*$/.test(u)) throw new WorldError("UID 只能填数字、字母和 #，最多 20 个字符。");
      uid[g] = u;
    }
    if (!input.anonymous && !name) throw new WorldError("想显示名字的话，先填一个名字吧。");
    const profile: Profile = {
      anonymous: input.anonymous,
      name,
      drPrefix: input.drPrefix,
      games,
      favourites,
      uid,
      shareUid: input.shareUid,
      color: ROACH_COLORS.includes(input.color) ? input.color : EMPTY_PROFILE.color,
    };
    this.st.profiles[this.st.current] = profile;
    this.commit();
    return profile;
  }

  async placeRoach(target: PlaceTarget, spot: LngLat): Promise<OwnRoach[]> {
    // keep only the coordinates, whatever else the caller passed along
    const at = { lng: Number(spot.lng), lat: Number(spot.lat) };
    if (!Number.isFinite(at.lng) || !Number.isFinite(at.lat) || Math.abs(at.lat) > 85 || Math.abs(at.lng) > 180) {
      throw new WorldError("这个位置放不了蟑螂。");
    }
    const owner = this.st.current;
    this.materialize(owner);
    const mine = this.st.roaches.filter((r) => r.owner === owner);
    const main = mine.find((r) => r.slot === 0);
    let roach: StoredRoach | undefined;

    if (target.kind === "main") {
      roach = main;
      if (!roach) {
        roach = { ...at, id: randomHex(8), owner, slot: 0, pub: "" };
        this.st.roaches.push(roach);
      }
    } else if (target.kind === "clone") {
      if (!main) throw new WorldError("先放下蟑螂本体，才能放克隆体。");
      const used = new Set(mine.map((r) => r.slot));
      const slot = Array.from({ length: MAX_CLONES }, (_, i) => i + 1).find((s) => !used.has(s));
      if (!slot) throw new WorldError(`最多只能放 ${MAX_CLONES} 只克隆体。`);
      roach = { ...at, id: randomHex(8), owner, slot, pub: "" };
      this.st.roaches.push(roach);
    } else {
      roach = mine.find((r) => r.id === target.roachId);
      if (!roach) throw new WorldError("找不到这只蟑螂了。");
    }
    roach.lng = at.lng;
    roach.lat = at.lat;
    // A fresh public id on every move, so nobody can follow a roach between spots
    roach.pub = randomHex(8);
    this.commit();
    return this.ownRoaches(owner);
  }

  async removeRoach(roachId: string): Promise<OwnRoach[]> {
    const owner = this.st.current;
    this.materialize(owner);
    const roach = this.st.roaches.find((r) => r.owner === owner && r.id === roachId);
    if (!roach) throw new WorldError("找不到这只蟑螂了。");
    this.st.roaches = this.st.roaches.filter(
      (r) => !(r.owner === owner && (roach.slot === 0 || r.id === roachId)),
    );
    this.commit();
    return this.ownRoaches(owner);
  }

  private checkTouchQuota(from: PlayerId, now: number) {
    const today = this.st.touches.filter((t) => t.from === from && now - t.at < DAY);
    if (today.length >= TOUCHES_PER_DAY) throw new WorldError("今天的触须用完啦，明天再来吧。");
    return today;
  }

  async touch(publicId: string, bold: boolean): Promise<TouchResult> {
    const from = this.st.current;
    const roach = this.placed().byPub.get(publicId);
    if (!roach) throw new WorldError("这只蟑螂已经爬走了。");
    if (roach.owner === from) throw new WorldError("这是你自己的蟑螂。");
    const now = Date.now();
    const today = this.checkTouchQuota(from, now);
    // keyed by the public id, not the owner, so the answer cannot tell you two roaches share an owner
    if (today.some((t) => t.pub === publicId && now - t.at < TOUCH_SAME_ROACH_HOURS * HOUR)) {
      throw new WorldError("今天已经碰过这只蟑螂了，明天再来吧。");
    }
    this.st.touches = this.st.touches.filter((t) => now - t.at < INBOX_DAYS * DAY);
    this.st.touches.push({
      id: randomHex(8),
      from,
      to: roach.owner,
      bold,
      slot: roach.slot,
      pub: publicId,
      re: null,
      at: now,
    });
    const newFriend = bold ? this.befriendIfMutual(from, roach.owner, now) : null;
    this.commit();
    return { newFriend };
  }

  async reply(itemId: string, bold: boolean): Promise<TouchResult> {
    const from = this.st.current;
    const [kind, id] = itemId.split(":");
    let to: PlayerId | undefined;
    if (kind === "t") to = this.st.touches.find((t) => t.id === id && t.to === from)?.from;
    if (kind === "d") to = this.st.declarations.find((d) => d.id === id && d.to.includes(from))?.from;
    if (!to || !this.exists(to)) throw new WorldError("找不到这条消息的主人了。");
    if (this.replied(from, itemId)) throw new WorldError("已经碰过 TA 了。");
    const now = Date.now();
    this.checkTouchQuota(from, now);
    this.st.touches.push({ id: randomHex(8), from, to, bold, slot: null, pub: null, re: itemId, at: now });
    const newFriend = bold ? this.befriendIfMutual(from, to, now) : null;
    this.commit();
    return { newFriend };
  }

  async inbox(): Promise<InboxItem[]> {
    const me = this.st.current;
    const since = Date.now() - INBOX_DAYS * DAY;
    const items: InboxItem[] = [];
    for (const t of this.st.touches) {
      if (t.to !== me || t.at <= since) continue;
      const id = `t:${t.id}`;
      items.push({
        kind: "touch",
        id,
        at: t.at,
        seen: Boolean(t.seen),
        bold: t.bold,
        target: t.re ? (t.re.startsWith("d:") ? "declaration" : "touch") : t.slot ? "clone" : "main",
        from: t.bold ? this.publicProfile(t.from) : null,
        replied: this.replied(me, id),
      });
    }
    for (const d of this.st.declarations) {
      if (d.at <= since || !d.to.includes(me)) continue;
      const id = `d:${d.id}`;
      items.push({
        kind: "declaration",
        id,
        at: d.at,
        seen: d.seen.includes(me),
        text: declarationText(d.d),
        replied: this.replied(me, id),
      });
    }
    for (const f of this.st.friendships) {
      if (f.at <= since || (f.a !== me && f.b !== me)) continue;
      items.push({
        kind: "friend",
        id: `f:${pairKey(f.a, f.b)}`,
        at: f.at,
        seen: f.seen.includes(me),
        from: this.publicProfile(otherOf(f, me)),
        friendId: this.friendId(otherOf(f, me)),
        replied: true,
      });
    }
    return items.sort((a, b) => b.at - a.at);
  }

  async markSeen(itemIds: string[]): Promise<void> {
    const me = this.st.current;
    const now = Date.now();
    for (const itemId of itemIds) {
      const [kind, id] = itemId.split(":");
      if (kind === "t") {
        const t = this.st.touches.find((x) => x.id === id && x.to === me);
        if (t && !t.seen) t.seen = now;
      } else if (kind === "d") {
        const d = this.st.declarations.find((x) => x.id === id);
        if (d && d.to.includes(me) && !d.seen.includes(me)) d.seen.push(me);
      } else if (kind === "f") {
        const f = this.st.friendships.find((x) => pairKey(x.a, x.b) === id);
        if (f && (f.a === me || f.b === me) && !f.seen.includes(me)) f.seen.push(me);
      }
    }
    this.commit();
  }

  async declare(d: Declaration): Promise<{ reach: string }> {
    const from = this.st.current;
    const profile = this.profileOf(from);
    if (d.template === "iam") {
      const game = GAMES.find((g) => profile.games.includes(g) && profile.favourites[g].includes(d.character));
      if (!game) throw new WorldError("只能选你资料里的厨力角色。");
      if (!titlesFor(game).includes(d.title)) throw new WorldError("这个称呼不在列表里。");
    } else if (!isGame(d.game)) {
      throw new WorldError("选一个游戏吧。");
    }
    const { list } = this.placed();
    const main = list.find((r) => r.owner === from && r.slot === 0);
    if (!main) throw new WorldError("先放下蟑螂本体，才能发表独立宣言。");

    const now = Date.now();
    const mine = this.st.declarations.filter((x) => x.from === from && now - x.at < DAY);
    if (mine.length >= DECLARATIONS_PER_DAY) throw new WorldError("今天的宣言发得够多啦，明天再来吧。");
    if (mine.some((x) => now - x.at < DECLARATION_COOLDOWN_MIN * MINUTE)) {
      throw new WorldError("刚刚才发过宣言，歇一会儿再发吧。");
    }

    // True positions, server side in a real deployment; the sender only learns a rough count
    const to = new Set<PlayerId>();
    for (const r of list) {
      if (r.owner !== from && distanceKm(main, r) <= DECLARATION_RADIUS_KM) to.add(r.owner);
    }
    this.st.declarations.push({ id: randomHex(8), from, d, at: now, to: [...to], seen: [] });
    const since = now - INBOX_DAYS * DAY;
    this.st.declarations = this.st.declarations.filter((x) => x.at > since).slice(-MAX_DECLARATIONS_KEPT);
    this.commit();
    return { reach: reachText(to.size) };
  }

  async friends(): Promise<Friend[]> {
    const me = this.st.current;
    const since = Date.now() - INBOX_DAYS * DAY;
    const { list } = this.placed();
    return this.st.friendships
      .filter((f) => f.a === me || f.b === me)
      .sort((x, y) => y.at - x.at)
      .map((f) => {
        const other = otherOf(f, me);
        const history: FriendEvent[] = [];
        for (const t of this.st.touches) {
          if (t.from === other) history.push({ kind: "touched", at: t.at, bold: t.bold, you: t.to === me });
          if (t.to === other) history.push({ kind: "touchedBy", at: t.at, bold: t.bold, you: t.from === me });
        }
        const declarations = this.st.declarations.filter((d) => d.from === other && d.at > since);
        for (const d of declarations) history.push({ kind: "declared", at: d.at, text: declarationText(d.d) });
        for (const g of this.st.friendships) {
          if (g.a === other || g.b === other) history.push({ kind: "befriended", at: g.at, you: otherOf(g, other) === me });
        }
        return {
          id: this.friendId(other),
          since: f.at,
          profile: this.publicProfile(other),
          roaches: list
            .filter((r) => r.owner === other)
            .sort((a, b) => a.slot - b.slot)
            .map((r) => this.publicRoach(r, true)),
          declarations: declarations.length,
          history: history.sort((a, b) => b.at - a.at).slice(0, FRIEND_HISTORY),
        };
      });
  }

  async unfriend(friendId: string): Promise<void> {
    const me = this.st.current;
    const f = this.st.friendships.find((x) => (x.a === me || x.b === me) && this.friendId(otherOf(x, me)) === friendId);
    if (!f) throw new WorldError("你们已经不是触须之交了。");
    this.st.friendships = this.st.friendships.filter((x) => x !== f);
    this.st.cuts[pairKey(f.a, f.b)] = Date.now();
    this.commit();
  }

  async identities(): Promise<Identity[]> {
    const current = this.st.current;
    const unseen = this.unseenCounts();
    const out: Identity[] = [
      { id: ME, label: "我", note: "你自己", unseen: unseen.get(ME) ?? 0, current: current === ME, group: "me" },
    ];
    for (const t of TESTERS) {
      const p = this.profileOf(t.id);
      out.push({
        id: t.id,
        label: p.anonymous && p.name.trim() ? `${p.name.trim()}（匿名）` : displayName(p),
        note: t.note,
        unseen: unseen.get(t.id) ?? 0,
        current: current === t.id,
        group: "tester",
      });
    }
    // Passers-by worth stepping into: ones somebody touched, ones you already were, and the current one
    const touched = new Set(this.st.touches.filter((t) => !t.seen).map((t) => t.to));
    const ids = new Set([...touched, ...this.st.materialized, current]);
    for (const id of ids) {
      const i = passerbyIndex(id);
      if (i < 0) continue;
      const p = passersby()[i];
      out.push({
        id,
        label: `路人舟p #${i + 1}`,
        note: p.city,
        unseen: unseen.get(id) ?? 0,
        current: current === id,
        group: "passerby",
      });
    }
    return out;
  }

  async become(id: PlayerId): Promise<void> {
    if (!this.exists(id)) throw new WorldError("没有这个测试身份。");
    this.st.current = id;
    this.commit();
  }

  async reset(): Promise<void> {
    this.st = this.fresh(false);
    this.passerbyPub.clear();
    this.commit();
  }
}

export function reachText(n: number) {
  const km = `${DECLARATION_RADIUS_KM} 公里内`;
  if (n === 0) return `${km}暂时没有别的舟p，宣言飘向了远方……`;
  if (n < 5) return `${km}有不到 5 只舟p收到了你的宣言。`;
  for (const [lo, hi] of [
    [5, 10],
    [10, 20],
    [20, 50],
  ]) {
    if (n < hi) return `${km}有 ${lo}–${hi} 只舟p收到了你的宣言。`;
  }
  return `${km}有 50 多只舟p收到了你的宣言！`;
}
