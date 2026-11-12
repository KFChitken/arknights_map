import type { Area } from "./area";
import { feedIdsOf, unpackRoaches } from "./packed";
import type { AreaUpdate, MapRoach, RoachFeedUpdate, TilesUpdate, TileUpdate } from "./types";

/** How many roaches there are in all, by 塔露拉干员's fire, riding with 明河都尉, and how many players they belong to */
export type AreaTotals = { total: number; fire: number; riders: number; players?: number };

/** An area answer's t as named counts; no players from a server from before it said so */
export function totalsOf(t: NonNullable<AreaUpdate["t"]>): AreaTotals {
  return { total: t[0], fire: t[1], riders: t[2], ...(typeof t[3] === "number" ? { players: t[3] } : {}) };
}

/**
 * The browser's copy of the shared roach feed, kept current by applying only what changed. Its
 * roaches go by short ids (world/packed.ts): compare them with public ids through sameRoach or feedIdsOf.
 */
export class RoachFeedCopy {
  private v: string | null = null;
  private byId = new Map<string, MapRoach>();
  private list: MapRoach[] = [];

  /** The version held, to ask the server what changed since. */
  get version() {
    return this.v;
  }

  /** Every roach, in a fixed order that says nothing about who placed what when. */
  get roaches() {
    return this.list;
  }

  /** Take in an answer from the server. True when the roaches changed. */
  apply(u: RoachFeedUpdate): boolean {
    let changed = false;
    const all = u.packed ? unpackRoaches(u.packed) : u.roaches;
    if (all) {
      this.byId = new Map(all.map((r) => [r.id, r]));
      changed = true;
    } else {
      for (const r of u.changed ?? []) {
        this.byId.set(r.id, r);
        changed = true;
      }
      for (const id of u.removed ?? []) changed = this.byId.delete(id) || changed;
    }
    this.v = u.v;
    if (changed) this.sort();
    return changed;
  }

  /** Drop roaches we know are gone before the server says so, such as our own after deleting the account; by public id. */
  forget(ids: string[]): boolean {
    let changed = false;
    for (const id of ids) for (const k of feedIdsOf(id)) changed = this.byId.delete(k) || changed;
    if (changed) this.sort();
    return changed;
  }

  private sort() {
    this.list = [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

/**
 * The browser's copy of one area of the feed (world/area.ts): the roaches of a box, kept current by what
 * changed in it, or the overview, which comes whole. Short ids, as RoachFeedCopy.
 */
export class RoachAreaCopy {
  private v: string | null = null;
  private held: Area | null = null;
  private byId = new Map<string, MapRoach>();
  private list: MapRoach[] = [];
  /** When the area held came whole (Date.now()) */
  heldAt = 0;
  /** How many roaches there are in all, by the fire, riding with 明河都尉, and how many players they belong to, as the server last said */
  totals: AreaTotals | null = null;

  /** The version held, to ask what changed in the box since; null without one */
  get version() {
    return this.v;
  }

  /** The box held, or "overview"; null before anything came */
  get area() {
    return this.held;
  }

  /** Its roaches, in a fixed order */
  get roaches() {
    return this.list;
  }

  /** Take in an answer for an area. True when the roaches changed. */
  apply(u: AreaUpdate): boolean {
    if (u.t) this.totals = totalsOf(u.t);
    let changed = false;
    if (u.packed) {
      this.byId = new Map(unpackRoaches(u.packed).map((r) => [r.id, r]));
      this.held = u.overview ? "overview" : (u.box ?? null);
      this.heldAt = Date.now();
      changed = true;
    } else {
      for (const r of u.changed ?? []) {
        this.byId.set(r.id, r);
        changed = true;
      }
      for (const id of u.removed ?? []) changed = this.byId.delete(id) || changed;
    }
    this.v = u.v;
    if (changed) this.list = [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return changed;
  }

  /** Drop roaches we know are gone before the server says so; by public id. */
  forget(ids: string[]): boolean {
    let changed = false;
    for (const id of ids) for (const k of feedIdsOf(id)) changed = this.byId.delete(k) || changed;
    if (changed) this.list = [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return changed;
  }
}

/** How many tiles of the overview a page keeps, drawn or not (each a few to some tens of KB) */
const TILES_HELD = 300;

/**
 * The browser's copy of the overview by tiles (world/area.ts tilesFor): the tiles it was given, each with when,
 * and which tiles there are roaches in. Only the tiles round the view are drawn; the others are kept for the
 * way back. Short ids, as RoachFeedCopy; each roach stands for all those in its square (n).
 */
export class RoachTilesCopy {
  private held = new Map<string, { at: number; roaches: MapRoach[] }>();
  private wanted: string[] = [];
  private list: MapRoach[] = [];
  /** The tiles there are roaches in, as the server last said, and when (Date.now()) */
  index: { at: number; tiles: Set<string> } | null = null;
  totals: AreaTotals | null = null;

  /** The roaches of the tiles round the view that have come, in a fixed order */
  get roaches() {
    return this.list;
  }

  /** Whether a tile has roaches, as far as is known (before the list comes, every one may) */
  listed(x: number, y: number) {
    return this.index?.tiles.has(`${x}_${y}`) ?? true;
  }

  /** When a tile came (Date.now()), if it did */
  heldAt(x: number, y: number) {
    return this.held.get(`${x}_${y}`)?.at;
  }

  /** The tiles round the view now: those held are drawn. True when what is drawn changed. */
  want(tiles: [number, number][]): boolean {
    const keys = tiles.map(([x, y]) => `${x}_${y}`);
    const before = this.drawnKey();
    this.wanted = keys;
    if (this.drawnKey() === before) return false;
    this.compose();
    return true;
  }

  /** Whether any tile round the view has come (anything to draw yet) */
  get any() {
    return this.wanted.some((k) => this.held.has(k));
  }

  applyIndex(u: TilesUpdate) {
    if (u.t) this.totals = totalsOf(u.t);
    this.index = { at: Date.now(), tiles: new Set(u.tiles.map(([x, y]) => `${x}_${y}`)) };
    // tiles that no longer have roaches: let go
    let changed = false;
    for (const k of [...this.held.keys()]) {
      if (!this.index.tiles.has(k)) changed = this.held.delete(k) || changed;
    }
    if (changed) this.compose();
  }

  /** A tile whole. True when what is drawn changed. */
  applyTile(u: TileUpdate): boolean {
    if (u.t) this.totals = totalsOf(u.t);
    const k = `${u.tile[0]}_${u.tile[1]}`;
    this.held.delete(k);
    this.held.set(k, { at: Date.now(), roaches: unpackRoaches(u.packed) });
    // the least lately come go first, but never one drawn
    for (const old of this.held.keys()) {
      if (this.held.size <= TILES_HELD) break;
      if (!this.wanted.includes(old)) this.held.delete(old);
    }
    if (!this.wanted.includes(k)) return false;
    this.compose();
    return true;
  }

  private drawnKey() {
    return this.wanted.filter((k) => this.held.has(k)).join(";");
  }

  private compose() {
    const out: MapRoach[] = [];
    for (const k of this.wanted) for (const r of this.held.get(k)?.roaches ?? []) out.push(r);
    this.list = out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
