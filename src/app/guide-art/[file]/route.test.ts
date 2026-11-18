import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "guide-art-"));
writeFileSync(path.join(dir, "haimao-damedane.m4a"), "m4a");
writeFileSync(path.join(dir, "haimao-day.webp"), "webp");

/** The settings the route reads when loaded: each test loads it afresh. */
async function load(env: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, { GUIDE_ART_DIR: dir, ...env });
  return (await import("./route")).GET;
}

async function get(file: string, env: Record<string, string>) {
  const GET = await load(env);
  const res = await GET(new Request(`http://localhost/guide-art/${file}`), { params: Promise.resolve({ file }) });
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), body: await res.text() };
}

describe("the guides' pictures", () => {
  afterEach(() => {
    for (const key of ["GUIDE_ART_DIR", "HAIMAO", "HAIMAO_CLIPS", "HAIMAO_PICTURE"]) delete process.env[key];
  });

  it("hand out 香艳制作人's damedane while she shows to anyone, unless HAIMAO_CLIPS is off; kept an hour", async () => {
    expect(await get("haimao-damedane.m4a", { HAIMAO: "admins" })).toEqual({
      status: 200,
      type: "audio/mp4",
      cache: "public, max-age=3600",
      body: "m4a",
    });
    expect((await get("haimao-damedane.m4a", { HAIMAO: "on", HAIMAO_PICTURE: "off" })).status).toBe(200);
    expect((await get("haimao-damedane.m4a", { HAIMAO: "on", HAIMAO_CLIPS: "off" })).status).toBe(404);
    expect((await get("haimao-damedane.m4a", { HAIMAO: "off" })).status).toBe(404);
    expect((await get("haimao-damedane.m4a", {})).status).toBe(404);
  });

  it("keep the others a month, as before", async () => {
    expect(await get("haimao-day.webp", { HAIMAO: "on" })).toMatchObject({ status: 200, type: "image/webp", cache: "public, max-age=2592000" });
    expect((await get("haimao-other.m4a", { HAIMAO: "on" })).status).toBe(404);
  });
});
