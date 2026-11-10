import { feedIdsOf, unpackRoaches } from "./packed";
import type { MapRoach, RoachFeedUpdate } from "./types";

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
