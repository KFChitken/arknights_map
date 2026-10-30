import { describe, expect, it } from "vitest";
import { inMainland } from "./region";

describe("mainland China addresses", () => {
  it("knows mainland blocks from elsewhere, IPv4 and IPv6", () => {
    // 114DNS and AliDNS are in mainland China
    expect(inMainland("114.114.114.114")).toBe(true);
    expect(inMainland("223.5.5.5")).toBe(true);
    expect(inMainland("2400:3200::1")).toBe(true);
    expect(inMainland("::ffff:114.114.114.114")).toBe(true);
    // Google, Cloudflare, Hong Kong (HKIX), Taiwan (HiNet)
    expect(inMainland("8.8.8.8")).toBe(false);
    expect(inMainland("1.1.1.1")).toBe(false);
    expect(inMainland("2001:4860:4860::8888")).toBe(false);
    expect(inMainland("123.255.88.1")).toBe(false);
    expect(inMainland("168.95.1.1")).toBe(false);
  });

  it("is never fooled by something that is not an address", () => {
    expect(inMainland("local")).toBe(false);
    expect(inMainland("")).toBe(false);
    expect(inMainland("114.114.114")).toBe(false);
    expect(inMainland("999.114.114.114")).toBe(false);
    expect(inMainland("2400:3200::1::1")).toBe(false);
  });
});
