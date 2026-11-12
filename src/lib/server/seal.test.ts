import { afterEach, describe, expect, it } from "vitest";
import { BACKUP_CODES, backupHash, makeBackupCodes, normalBackupCode, open, seal } from "./seal";

const SECRET = process.env.AUTH_SECRET;

afterEach(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("sealing", () => {
  it("opens what it sealed, and nothing changed", () => {
    const sealed = seal("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("GEZD");
    expect(open(sealed)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    // a fresh IV each time
    expect(seal("same")).not.toBe(seal("same"));

    const [v, iv, body, tag] = sealed.split(".");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    for (const changed of [
      [v, flip(iv), body, tag],
      [v, iv, flip(body), tag],
      [v, iv, body, flip(tag)],
      [v, iv, body, tag.slice(0, 8)],
      ["v2", iv, body, tag],
      [v, iv, body],
    ]) {
      expect(() => open(changed.join(".")), changed.join(".")).toThrow();
    }
  });

  it("cannot open what another AUTH_SECRET sealed", () => {
    const sealed = seal("GEZDGNBVGY3TQOJQ");
    process.env.AUTH_SECRET = "another-test-secret-0123456789";
    expect(() => open(sealed)).toThrow();
    process.env.AUTH_SECRET = SECRET;
    expect(open(sealed)).toBe("GEZDGNBVGY3TQOJQ");
  });
});

describe("backup codes", () => {
  it("come ten at a time, like 7KQ2-M9XD, without letters easy to mix up", () => {
    const codes = makeBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODES);
    expect(new Set(codes).size).toBe(BACKUP_CODES);
    for (const c of codes) expect(c).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });

  it("match however they are typed, and only for their own person", () => {
    const [code] = makeBackupCodes();
    const hash = backupHash("user-a", code);
    expect(hash).toMatch(/^[\w-]{43}$/);
    for (const typed of [code, code.toLowerCase(), code.replace("-", " "), ` ${code.replace("-", "")} `]) {
      expect(backupHash("user-a", typed), typed).toBe(hash);
    }
    expect(backupHash("user-b", code)).not.toBe(hash);
    // not one: a letter outside the alphabet, the wrong length
    for (const bad of ["ABCD-EFG0", "ABCD-EFGO", "ABC-DEFG", "", null]) {
      expect(normalBackupCode(bad), String(bad)).toBeNull();
      expect(backupHash("user-a", bad)).toBeNull();
    }
  });
});
