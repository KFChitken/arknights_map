import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { db } from "./db";
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
  it("logs an unexpected error by its request and codes, never its message", async () => {
    const said: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(" ")));
    try {
      const failing = route(async () => {
        await db.execute(sql`select ${"secret.doctor@qq.com"}::uuid`);
        return new Response("never");
      });
      const res = await failing(new NextRequest("http://localhost/api/test"), undefined);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "服务器出了点问题，稍后再试试。" });
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/^GET \/api\/test DrizzleQueryError caused by PostgresError 22P02\n {2}query: select \$1::uuid\n\s+at /);
      expect(said[0]).not.toContain("secret.doctor");
    } finally {
      error.mockRestore();
    }
  });

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
