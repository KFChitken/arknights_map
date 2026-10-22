import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { clientIp } from "./http";

const request = (headers: Record<string, string>) => new NextRequest("http://localhost/api", { headers });

describe("clientIp", () => {
  it("trusts only the address our proxy appended, not what the client claims", () => {
    expect(clientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("ignores X-Real-IP, which a client can send too", () => {
    expect(clientIp(request({ "x-real-ip": "6.6.6.6" }))).toBe("local");
  });
});
