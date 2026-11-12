import type { Area } from "./area";
import { feedIdsOf, unpackRoaches } from "./packed";
import type { AreaUpdate, MapRoach, RoachFeedUpdate } from "./types";

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
      // the overview's roaches each at a spot of its own in its square, not in rows at the middles
      this.byId = new Map(unpackRoaches(u.packed, true).map((r) => [r.id, r]));
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
