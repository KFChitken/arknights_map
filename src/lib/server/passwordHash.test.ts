import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { busy, DUMMY_HASH, HASHING_AT_ONCE, hashPassword, verifyPassword, WAIT_MS } from "./passwordHash";

describe("password digests", () => {
  it("checks a password against its own digest only", async () => {
    const stored = await hashPassword("roach-in-the-rain");
    const parts = stored.split("$");
    expect(parts.slice(0, 4)).toEqual(["scrypt", "14", "8", "5"]);
    expect(Buffer.from(parts[5], "base64url")).toHaveLength(32);
    expect(await verifyPassword(stored, "roach-in-the-rain")).toBe(true);
    expect(await verifyPassword(stored, "roach-in-the-snow")).toBe(false);
    // the same password typed the full-width way (NFKC)
    expect(await verifyPassword(stored, "ｒｏａｃｈ-in-the-rain")).toBe(true);
    expect(await verifyPassword(await hashPassword("roach-in-the-rain"), "x")).toBe(false);
  });

  it("still checks digests made at other costs, and never matches a broken one", async () => {
    const salt = Buffer.from("0123456789abcdef");
    const key = scryptSync("older-one-1", salt, 32, { N: 2 ** 10, r: 8, p: 1 });
    const old = ["scrypt", "10", "8", "1", salt.toString("base64url"), key.toString("base64url")].join("$");
    expect(await verifyPassword(old, "older-one-1")).toBe(true);
    expect(await verifyPassword(old, "older-one-2")).toBe(false);
    for (const broken of ["", "plain", "scrypt$14$8$5$$", "bcrypt$1$2$3$4$5"]) expect(await verifyPassword(broken, "anything")).toBe(false);
    expect(await verifyPassword(DUMMY_HASH, "anything")).toBe(false);
  });

  it("hashes a few at a time, and turns away one kept waiting too long", async () => {
    const many = Array.from({ length: HASHING_AT_ONCE + 1 }, () => hashPassword("roach-in-the-rain"));
    expect((await Promise.all(many)).every((h) => h.startsWith("scrypt$"))).toBe(true);
    // a crowd too big to get through before WAIT_MS: some are turned away with busy()
    const crowd = Array.from({ length: Math.ceil((WAIT_MS / 50) * HASHING_AT_ONCE) + 30 }, () =>
      verifyPassword(DUMMY_HASH, "x").then(
        () => "ok",
        (e: Error) => e.message,
      ),
    );
    const said = await Promise.all(crowd);
    expect(said).toContain(busy());
    expect(said).toContain("ok");
  }, 30_000);
});
