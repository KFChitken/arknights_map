import { describe, expect, it } from "vitest";
import { base32, cleanCode, fromBase32, groupedSecret, matchTotp, newTotpSecret, rightStep, totpCode, totpStep, totpUri } from "./totp";

// RFC 6238 appendix B: the SHA-1 key, and its 8-digit codes cut to the 6 an authenticator shows
const RFC_KEY = Buffer.from("12345678901234567890");
const RFC_SECRET = base32(RFC_KEY);

describe("authenticator codes", () => {
  it("are RFC 6238's", () => {
    const at = (s: number) => totpCode(RFC_KEY, totpStep(s * 1000));
    expect(at(59)).toBe("287082");
    expect(at(1111111109)).toBe("081804");
    expect(at(1111111111)).toBe("050471");
    expect(at(1234567890)).toBe("005924");
    expect(at(2000000000)).toBe("279037");
    // the same from the secret as an authenticator app gets it
    expect(totpCode(RFC_SECRET, totpStep(59_000))).toBe("287082");
  });

  it("writes and reads base32 as authenticator apps do, without padding", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(fromBase32("gezd gnbv gy3t qojq gezd gnbv gy3t qojq")?.equals(RFC_KEY)).toBe(true);
    expect(fromBase32("GEZD1")).toBeNull();
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(fromBase32(secret)).toHaveLength(20);
    expect(groupedSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });

  it("puts the issuer and the alias in the QR code, and no email", () => {
    const uri = totpUri("ABCDEFGH", "站长");
    expect(uri).toBe(
      "otpauth://totp/%E8%88%9FP%20%E7%AE%A1%E7%90%86%E5%8F%B0:%E7%AB%99%E9%95%BF?secret=ABCDEFGH&issuer=%E8%88%9FP%20%E7%AE%A1%E7%90%86%E5%8F%B0&algorithm=SHA1&digits=6&period=30",
    );
    expect(uri).not.toContain("@");
  });

  it("takes a code a step early or late, not two, and a step only once", () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    const code = (s: number) => totpCode(RFC_SECRET, s);
    expect(matchTotp(RFC_SECRET, code(step), now, null)).toBe(step);
    expect(matchTotp(RFC_SECRET, code(step - 1), now, null)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, code(step + 1), now, null)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, code(step - 2), now, null)).toBeNull();
    expect(matchTotp(RFC_SECRET, code(step + 2), now, null)).toBeNull();
    // used: this step, or an earlier one, is taken
    expect(matchTotp(RFC_SECRET, code(step), now, step)).toBeNull();
    expect(matchTotp(RFC_SECRET, code(step - 1), now, step - 1)).toBeNull();
    expect(matchTotp(RFC_SECRET, code(step), now, step - 1)).toBe(step);
    // used or not, rightStep tells which step it is for
    expect(rightStep(RFC_SECRET, code(step), now)).toBe(step);
  });

  it("takes six digits as typed, spaces and all, and nothing else", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
    expect(cleanCode("123-456")).toBe("123456");
    for (const bad of ["12345", "1234567", "12345a", "", null, undefined, 123456]) {
      expect(cleanCode(bad)).toBe(typeof bad === "number" ? "123456" : null);
    }
    expect(matchTotp(RFC_SECRET, "abcdef", 59_000, null)).toBeNull();
  });
});
