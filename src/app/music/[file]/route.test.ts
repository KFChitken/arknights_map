import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { musicLink } from "@/lib/server/musicLinks";
import { GET } from "./route";

// the songs' folder for this test, and whether it runs as the live site would
const env = vi.hoisted(() => ({ prod: false, dir: "" }));
vi.mock("@/lib/server/env", async (original) => {
  const real = await original<typeof import("@/lib/server/env")>();
  return {
    ...real,
    get isProd() {
      return env.prod;
    },
    get MUSIC_DIR() {
      return env.dir;
    },
  };
});

env.dir = mkdtempSync(path.join(tmpdir(), "music-route-"));
mkdirSync(path.join(env.dir, "files"));
const FILE = "00000000000000aa.m4a";
const BYTES = Buffer.from("0123456789abcdef");
writeFileSync(path.join(env.dir, "files", FILE), BYTES);
writeFileSync(path.join(env.dir, "catalog.json"), "{}");
const COVER = "00000000000000cc.jpg";
const PICTURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
writeFileSync(path.join(env.dir, "files", COVER), PICTURE);

const get = (file: string, query: string, headers: Record<string, string> = {}) =>
  GET(new Request(`http://localhost/music/${file}${query}`, { headers }), { params: Promise.resolve({ file }) });
const query = (link: string) => link.slice(link.indexOf("?"));

afterEach(() => {
  env.prod = false;
  vi.unstubAllEnvs();
});

describe("/music in development", () => {
  it("serves a song at a good link, whole or in the ranges asked for", async () => {
    vi.stubEnv("LISTEN", "on");
    const q = query(musicLink(FILE));
    const whole = await get(FILE, q);
    expect([whole.status, whole.headers.get("content-type"), whole.headers.get("accept-ranges")]).toEqual([200, "audio/mp4", "bytes"]);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(BYTES);
    const part = await get(FILE, q, { range: "bytes=2-5" });
    expect([part.status, part.headers.get("content-range")]).toEqual([206, "bytes 2-5/16"]);
    expect(Buffer.from(await part.arrayBuffer()).toString()).toBe("2345");
    expect((await get(FILE, q, { range: "bytes=99-" })).status).toBe(416);
  });

  it("refuses a link that is not good, a file that is not there, and anything that is not a song", async () => {
    vi.stubEnv("LISTEN", "on");
    const q = query(musicLink(FILE));
    expect((await get(FILE, "")).status).toBe(403);
    expect((await get(FILE, `${q.slice(0, -1)}x`)).status).toBe(403);
    const missing = "00000000000000bb.m4a";
    expect((await get(missing, query(musicLink(missing)))).status).toBe(404);
    expect((await get("catalog.json", q)).status).toBe(404);
    vi.stubEnv("LISTEN", "off");
    expect((await get(FILE, q)).status).toBe(403);
  });

  it("serves an album's cover to anyone, with no link, kept a year; only one that is there", async () => {
    // 听歌 off too: a cover is no song
    vi.stubEnv("LISTEN", "off");
    const got = await get(COVER, "");
    expect([got.status, got.headers.get("content-type"), got.headers.get("cache-control")]).toEqual([200, "image/jpeg", "public, max-age=31536000, immutable"]);
    expect(Buffer.from(await got.arrayBuffer())).toEqual(PICTURE);
    expect((await get("00000000000000dd.jpg", "")).status).toBe(404);
    for (const odd of ["00000000000000CC.jpg", "00000000000000cc.jpeg", "00000000000000cc.png", "..%2F00000000000000cc.jpg"]) {
      expect((await get(odd, "")).status, odd).toBe(404);
    }
  });
});

describe("/music on the live site", () => {
  it("is a 404 for everything, a good link too: Caddy serves the songs there", async () => {
    vi.stubEnv("LISTEN", "on");
    env.prod = true;
    expect((await get(FILE, query(musicLink(FILE)))).status).toBe(404);
    expect((await get(COVER, "")).status).toBe(404);
  });
});
