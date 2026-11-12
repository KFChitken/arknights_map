import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import { users } from "./schema";
import { errorForLog } from "./signals";

const SECRET = "secret.doctor@qq.com";

/** What a call threw */
const thrown = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("it did not fail");
    },
    (e: unknown) => e,
  );

beforeEach(async () => {
  await db.delete(users).where(eq(users.email, SECRET));
});

describe("an error for the log", () => {
  it("of a failed query: its codes, its SQL and where it was thrown, never its values", async () => {
    await db.insert(users).values({ email: SECRET });
    // the database's own words name the address too (Key (email)=(…) already exists)
    const twice = errorForLog(await thrown(db.insert(users).values({ email: SECRET })));
    expect(twice).toMatch(/^DrizzleQueryError caused by PostgresError 23505 users_email_unique\n {2}query: insert into "users" \(/);
    expect(twice).toMatch(/^\s+at /m);
    // and a message of the database's that quotes what it was given
    const quoted = errorForLog(await thrown(db.execute(sql`select ${SECRET}::uuid`)));
    expect(quoted).toMatch(/^DrizzleQueryError caused by PostgresError 22P02\n {2}query: select \$1::uuid\n\s+at /);
    for (const text of [twice, quoted]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("params");
    }
  });

  it("of a mail that could not go: its codes, not the address in its message or its lists", () => {
    const e = Object.assign(new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${SECRET}>: Recipient address rejected`), {
      code: "EENVELOPE",
      responseCode: 550,
      rejected: [SECRET],
    });
    const text = errorForLog(e);
    expect(text).toMatch(/^Error EENVELOPE 550\n\s+at /);
    expect(text).not.toContain(SECRET);
  });

  it("leaves out the lines of a message that look like the stack's", () => {
    const text = errorForLog(new Error(`no account\n    at ${SECRET}`));
    expect(text).toMatch(/^Error\n\s+at /);
    expect(text).not.toContain(SECRET);
  });

  it("says only the type of something thrown that is not an error", () => {
    expect(errorForLog(SECRET)).toBe("string");
  });
});
