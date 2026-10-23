import type { MapRoach, RoachFeedUpdate } from "./types";

/** The browser's copy of the shared roach feed, kept current by applying only what changed. */
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
    if (u.roaches) {
      this.byId = new Map(u.roaches.map((r) => [r.id, r]));
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

  /** Drop roaches we know are gone before the server says so, such as our own after deleting the account. */
  forget(ids: string[]): boolean {
    let changed = false;
    for (const id of ids) changed = this.byId.delete(id) || changed;
    if (changed) this.sort();
    return changed;
  }

  private sort() {
    this.list = [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
