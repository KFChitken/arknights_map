import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pg } from "./db";
import { hearOthers } from "./live";
import { addNameWords, checkName, forgetNameWords, removeNameWords } from "./nameWords";
import { nameWords } from "./schema";

// Runs against the database named in vitest.config.mts, which is wiped before every test

beforeEach(async () => {
  await db.execute(sql`truncate ${nameWords}`);
  forgetNameWords();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const allowed = (name: string) => checkName(name).then(
  () => true,
  () => false,
);

describe("名字黑名单 on several processes", () => {
  // last: it leaves this process listening to the others
  it("is read again at once when it changes, here or on another process", async () => {
    vi.stubEnv("LIVE_ACROSS", "1");
    await hearOthers();
    expect(await allowed("小坏蛋")).toBe(true);

    // another process adds a word: what this one holds stays for a while, until that one says so
    await db.insert(nameWords).values({ word: "坏蛋" });
    expect(await allowed("小坏蛋")).toBe(true);
    await pg.notify("live_nudge", JSON.stringify({ p: "another-process", reload: "nameWords" }));
    await vi.waitFor(async () => expect(await allowed("小坏蛋")).toBe(false));

    // this process's own changes count here at once
    await removeNameWords("坏蛋");
    expect(await allowed("小坏蛋")).toBe(true);
    await addNameWords("坏蛋");
    expect(await allowed("小坏蛋")).toBe(false);
  });
});
