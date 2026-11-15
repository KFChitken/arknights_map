import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInRefused, verifyCode } from "./authClient";
import { THROWAWAY_EMAIL } from "./rules";

const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a refusal the server gives", () => {
  it("carries its code, for the sign-in sheet to go back to the email by", async () => {
    answer(403, { error: "换一个邮箱", code: THROWAWAY_EMAIL });
    const refused = await verifyCode("someone@grr.la", "123456").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(SignInRefused);
    expect(refused).toMatchObject({ message: "换一个邮箱", code: THROWAWAY_EMAIL });
  });

  it("is a plain error with its words when it has no code, as before", async () => {
    answer(400, { error: "验证码不对，再看看邮件。" });
    const refused = await verifyCode("someone@qq.com", "123456").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(SignInRefused);
    expect((refused as Error).message).toBe("验证码不对，再看看邮件。");
  });
});
