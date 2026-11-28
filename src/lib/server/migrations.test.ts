import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The migrations as drizzle-kit wrote them in drizzle/, which migrate() reads at start in the journal's order, running
 * only those whose `when` is later than the last one the database ran: one out of order is passed over without a word,
 * and found missing on the live database. Reads the files alone, no database.
 */
const DIR = new URL("../../../drizzle/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, DIR), "utf8");

type Entry = { when: number; tag: string };
const journal: Entry[] = JSON.parse(read("meta/_journal.json")).entries;
/** A migration's number: its tag's first 4 digits */
const num = (tag: string) => tag.slice(0, 4);
/** How to put right a migration made on a base that has moved on since */
const REDO =
  "made on an old base? On the new one, keep its drizzle/meta (journal and snapshots) as they are, delete your .sql, " +
  "run `npx drizzle-kit generate --name <the same name>` and check its SQL comes out as before. Renaming files is not enough";

describe("the migrations in drizzle/", () => {
  it("are in the journal in the order they were made, each `when` later than the one before", () => {
    for (let i = 1; i < journal.length; i++) {
      const [a, b] = [journal[i - 1], journal[i]];
      expect(b.when > a.when, `${b.tag} (when ${b.when}) is not later than ${a.tag} (when ${a.when}): ${REDO}`).toBe(true);
    }
  });

  it("each have a .sql file, and each .sql file is in the journal", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((f) => f.slice(0, -".sql".length));
    const tags = journal.map((e) => e.tag);
    expect(files.filter((f) => !tags.includes(f)), `.sql files the journal does not have: ${REDO}`).toEqual([]);
    expect(tags.filter((t) => !files.includes(t)), "migrations in the journal with no .sql file").toEqual([]);
  });

  it("are numbered in order, none twice (one may be missing: 0041 was taken back)", () => {
    for (const e of journal) expect(e.tag, "a tag is a number of 4 digits, then a name").toMatch(/^\d{4}_./);
    for (let i = 1; i < journal.length; i++) {
      const [a, b] = [journal[i - 1].tag, journal[i].tag];
      expect(num(b) > num(a), `${b} is numbered after ${a} in the journal, not above it: ${REDO}`).toBe(true);
    }
  });

  it("chain their snapshots: one a migration, each one's prevId the id of the one before", () => {
    const snaps = readdirSync(new URL("meta/", DIR))
      .filter((f) => f.endsWith("_snapshot.json"))
      .sort();
    expect(snaps, `a snapshot for each migration, and no other: ${REDO}`).toEqual(journal.map((e) => `${num(e.tag)}_snapshot.json`));
    let prev = "00000000-0000-0000-0000-000000000000";
    for (const f of snaps) {
      const s: { id: string; prevId: string } = JSON.parse(read(`meta/${f}`));
      expect(s.prevId, `${f}'s prevId is not the id of the snapshot before it: ${REDO}`).toBe(prev);
      prev = s.id;
    }
  });
});
