import { describe, expect, it } from "vitest";
import { passwordProblem } from "./passwordRules";

describe("what a password must be", () => {
  it("takes 8 to 64 characters, counted as characters", () => {
    expect(passwordProblem("short1!", "a@qq.com")).toMatch(/至少 8/);
    expect(passwordProblem("舟舟舟舟舟舟舟舟", "a@qq.com")).toBeNull();
    expect(passwordProblem("x".repeat(64), "a@qq.com")).toBeNull();
    expect(passwordProblem("x".repeat(65), "a@qq.com")).toMatch(/最多 64/);
  });

  it("turns away the commonest ones, in any case and width", () => {
    for (const pw of ["12345678", "PASSWORD", "woaini1314", "1qaz2wsx", "ｐａｓｓｗｏｒｄ", "88888888"]) expect(passwordProblem(pw, "a@qq.com")).toMatch(/太常见/);
    expect(passwordProblem("roach-in-the-rain", "a@qq.com")).toBeNull();
  });

  it("will not have the email, or its part before the @ when that is 4 or more long", () => {
    expect(passwordProblem("wang@163.com", "wang@163.com")).toMatch(/和邮箱一样/);
    expect(passwordProblem("x1234567890y", "1234567890@qq.com")).toMatch(/QQ 号/);
    // too short a part to mean anything
    expect(passwordProblem("abc-and-more", "abc@163.com")).toBeNull();
  });
});
