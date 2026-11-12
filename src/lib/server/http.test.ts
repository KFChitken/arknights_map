import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { clientIp, HttpError, route } from "./http";

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

describe("route", () => {
  it("answers a refusal with its words, and its code when it has one", async () => {
    const refuse = (code?: string) =>
      route(async () => {
        throw new HttpError(428, "先确认一下你满 18 岁了。", code);
      })(request({}), {});
    const coded = await refuse("age");
    expect(coded.status).toBe(428);
    expect(await coded.json()).toEqual({ error: "先确认一下你满 18 岁了。", code: "age" });
    expect(await (await refuse()).json()).toEqual({ error: "先确认一下你满 18 岁了。" });
  });
});
