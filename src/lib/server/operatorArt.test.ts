import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "operator-art-"));
writeFileSync(path.join(dir, "index.json"), JSON.stringify({ arknights: { 能天使: "0123456789abcdef.webp" }, endfield: {} }));
writeFileSync(path.join(dir, "0123456789abcdef.webp"), "webp");

/** The module reads its settings when loaded, so each test loads it afresh. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, env);
  return import("./operatorArt");
}

describe("character pictures", () => {
  afterEach(() => {
    delete process.env.OPERATOR_AVATARS;
    delete process.env.OPERATOR_ART_DIR;
  });

  it("lists the pictures there are, and hands out only their files", async () => {
    const art = await load({ OPERATOR_ART_DIR: dir });
    expect(await art.operatorArtIndex()).toEqual({ arknights: { 能天使: "0123456789abcdef.webp" }, endfield: {} });
    expect(String(await art.operatorArtFile("0123456789abcdef.webp"))).toBe("webp");
    expect(await art.operatorArtFile("index.json")).toBeNull();
    expect(await art.operatorArtFile("../index.json")).toBeNull();
    expect(await art.operatorArtFile("fedcba9876543210.webp")).toBeNull();
  });

  it("shows names alone when switched off, or before any picture is downloaded", async () => {
    const off = await load({ OPERATOR_ART_DIR: dir, OPERATOR_AVATARS: "off" });
    expect(await off.operatorArtIndex()).toEqual({ arknights: {}, endfield: {} });
    expect(await off.operatorArtFile("0123456789abcdef.webp")).toBeNull();
    const empty = await load({ OPERATOR_ART_DIR: path.join(dir, "nowhere") });
    expect(await empty.operatorArtIndex()).toEqual({ arknights: {}, endfield: {} });
  });
});
