import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LANG_HEADER } from "@/i18n/lang";
import { THROWAWAY_EMAIL } from "@/lib/rules";
import { currentSession, readSignupProof } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { issueLoginCode } from "@/lib/server/loginCodes";
import { forgetMailCount } from "@/lib/server/mailQuota";
import { loginCodes, mailSends, users } from "@/lib/server/schema";
import { POST as askForCode } from "../request-code/route";
import { POST as verify } from "./route";

// One browser's cookies, which every request below shares
const jar = vi.hoisted(() => {
  const held = new Map<string, string>();
  return {
    held,
    get: (name: string) => (held.has(name) ? { name, value: held.get(name)! } : undefined),
    set: (name: string, value: string) => void held.set(name, value),
    delete: (name: string) => void held.delete(name),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

// the codes go nowhere here: what the page is told is what counts
const mailed = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/server/mail", async (original) => ({
  ...(await original<typeof import("@/lib/server/mail")>()),
  sendLoginCode: async (to: string) => void mailed.push(to),
}));

/** A throwaway mail service's addresses (Guerrilla Mail's), one with an account made before and one without */
const OLD = "old.doctor@guerrillamailblock.com";
const NEW = "new.doctor@guerrillamailblock.com";
const REFUSED = "这个邮箱看起来是临时邮箱，不能用来注册新账号。请换一个常用的邮箱，比如 QQ、163 或 Outlook。";

const post = (handler: typeof verify, path: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    undefined,
  );
const tryCode = (email: string, code: string, headers?: Record<string, string>) => post(verify, "/api/auth/verify", { email, code }, headers);
const accountOf = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]?.id;

beforeEach(async () => {
  await db.execute(sql`truncate ${users} cascade`);
  await db.delete(loginCodes);
  await db.delete(mailSends);
  forgetMailCount();
  jar.held.clear();
  mailed.length = 0;
  await db.insert(users).values({ email: OLD });
});

afterEach(() => {
  delete process.env.THROWAWAY_CHECK;
});

describe("asking for a code at a throwaway mail service", () => {
  it("is answered alike whether the address has an account or not, and the code goes to both", async () => {
    const [old, fresh] = [await post(askForCode, "/api/auth/request-code", { email: OLD }), await post(askForCode, "/api/auth/request-code", { email: NEW })];
    expect([old.status, fresh.status]).toEqual([200, 200]);
    const [a, b] = [await old.json(), await fresh.json()];
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect({ ...a, expiresAt: 0 }).toEqual({ ...b, expiresAt: 0 });
    expect(mailed).toEqual([OLD, NEW]);
  });
});

describe("the code checked", () => {
  it("signs in an account made with a throwaway address before, as it always has", async () => {
    const { code } = await issueLoginCode(OLD);
    const res = await tryCode(OLD, code);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", hasPassword: false });
    expect((await currentSession())?.userId).toBe(await accountOf(OLD));
  });

  it("turns a new throwaway address away, with the code used up and no sign-up begun", async () => {
    const { code } = await issueLoginCode(NEW);
    const res = await tryCode(NEW, code);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: REFUSED, code: THROWAWAY_EMAIL });
    expect(await readSignupProof()).toBeNull();
    expect(await currentSession()).toBeNull();
    expect(await accountOf(NEW)).toBeUndefined();
    expect((await tryCode(NEW, code)).status).toBe(400);
  });

  it("says nothing of it before the code is right: a wrong one is answered as at any other address", async () => {
    const answers = [];
    for (const email of [NEW, OLD, "new.doctor@qq.com"]) {
      const { code } = await issueLoginCode(email);
      const res = await tryCode(email, code === "000000" ? "111111" : "000000");
      answers.push([res.status, await res.json()]);
    }
    expect(answers[0]).toEqual([400, { error: "验证码不对，再看看邮件。" }]);
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  it("lets a new address at a mail service people keep go on to sign up", async () => {
    for (const email of ["new.doctor@qq.com", "new.doctor@21cn.com", "new.doctor@mails.tsinghua.edu.cn"]) {
      jar.held.clear();
      const { code } = await issueLoginCode(email);
      const res = await tryCode(email, code);
      expect(await res.json(), email).toEqual({ status: "signup" });
      expect(await readSignupProof()).toBe(email);
    }
  });

  it("turns one away in English on the English site", async () => {
    const { code } = await issueLoginCode(NEW);
    const res = await tryCode(NEW, code, { [LANG_HEADER]: "en" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "This looks like a temporary email address, which can't be used to sign up. Please use an address you keep, such as Outlook, QQ or 163.",
      code: THROWAWAY_EMAIL,
    });
  });

  it("lets a new throwaway address sign up again with THROWAWAY_CHECK=off", async () => {
    process.env.THROWAWAY_CHECK = "off";
    const { code } = await issueLoginCode(NEW);
    expect(await (await tryCode(NEW, code)).json()).toEqual({ status: "signup" });
    expect(await readSignupProof()).toBe(NEW);
  });
});
