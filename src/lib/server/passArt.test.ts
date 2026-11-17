import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import framing from "@/data/pass-framing.json";
import type { ArtBox, ArtFrame } from "@/lib/passArt";

// what scripts/fetch-pass-art.mjs leaves: an index and each picture's files, named by their content
const dir = mkdtempSync(path.join(tmpdir(), "pass-art-"));
mkdirSync(path.join(dir, "pass"));
const A = "0123456789abcdef";
const B = "fedcba9876543210";
const C = "00112233445566ff";
writeFileSync(
  path.join(dir, "pass", "index.json"),
  JSON.stringify({
    note: "made by scripts/fetch-pass-art.mjs",
    art: {
      1: { file: A, color: "#7D338A", from: "prts" },
      145: { file: B, color: null, from: "hand" },
      3: { file: C, color: "red" },
      // not in the catalogue, not a picture's name: left out
      99999: { file: A, color: "#000000" },
      2: { file: "../index", color: "#123456" },
    },
  }),
);
for (const f of [`${A}.webp`, `${A}.avif`, `${A}.s.webp`, `${A}.b.webp`, `${B}.webp`, `${C}.webp`]) writeFileSync(path.join(dir, "pass", f), f);

/** The folder is read when the module loads, so each test loads it afresh */
async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./passArt");
}

const text = async (p: Promise<{ bytes: Buffer; type: string } | null>) => {
  const f = await p;
  return f && { text: String(f.bytes), type: f.type };
};

afterEach(() => vi.unstubAllEnvs());

describe("the pictures on passes", () => {
  it("lists those there are, with their colour where it is one, and hands out only their files", async () => {
    const art = await load({ OPERATOR_ART_DIR: dir });
    expect(await art.passArtList()).toEqual({ 1: [A, "#7d338a"], 145: [B, null], 3: [C, null] });
    expect(await text(art.passArtFile(`${A}.webp`))).toEqual({ text: `${A}.webp`, type: "image/webp" });
    expect(await text(art.passArtFile(`${A}.avif`))).toEqual({ text: `${A}.avif`, type: "image/avif" });
    expect(await text(art.passArtFile(`${A}.s.webp`))).toEqual({ text: `${A}.s.webp`, type: "image/webp" });
    expect(await text(art.passArtFile(`${A}.b.webp`))).toEqual({ text: `${A}.b.webp`, type: "image/webp" });
    for (const name of ["index.json", "../pass/index.json", `${B}.avif`, `${A}.x.webp`, `${A}.png`, `1111111111111111.webp`, `${A.toUpperCase()}.webp`, ""]) {
      expect(await art.passArtFile(name), name).toBeNull();
    }
  });

  it("are all taken down by PASS_ART=off, and some by PASS_ART_SKIP, their files with them", async () => {
    const off = await load({ OPERATOR_ART_DIR: dir, PASS_ART: "off" });
    expect(await off.passArtList()).toEqual({});
    expect(await off.passArtFile(`${A}.webp`)).toBeNull();

    const some = await load({ OPERATOR_ART_DIR: dir, PASS_ART_SKIP: " 1, 145,x,-3" });
    expect(await some.passArtList()).toEqual({ 3: [C, null] });
    expect(await some.passArtFile(`${A}.webp`)).toBeNull();
    expect(await some.passArtFile(`${C}.webp`)).not.toBeNull();
  });

  it("are none before the script has run", async () => {
    const none = await load({ OPERATOR_ART_DIR: path.join(dir, "nowhere") });
    expect(await none.passArtList()).toEqual({});
    expect(await none.passArtFile(`${A}.webp`)).toBeNull();
  });

  it("go out from the site's own routes: the list for a few minutes, a file for good", async () => {
    await load({ OPERATOR_ART_DIR: dir });
    const list = await (await import("@/app/api/pass-art/route")).GET();
    expect(list.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await list.json()).toEqual({ 1: [A, "#7d338a"], 145: [B, null], 3: [C, null] });
    const { GET } = await import("@/app/operator-art/pass/[file]/route");
    const file = (name: string) => GET(new Request(`http://localhost/operator-art/pass/${name}`), { params: Promise.resolve({ file: name }) });
    const ok = await file(`${A}.avif`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/avif");
    expect(ok.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await ok.text()).toBe(`${A}.avif`);
    expect((await file("index.json")).status).toBe(404);
  });
});

describe("where a few pictures are moved in their boxes (src/data/pass-framing.json)", () => {
  const frames = framing.framing as unknown as Record<string, ArtFrame>;
  // 风笛's picture, moved in all three boxes
  const MOVED = "9f8c7a61d2a0df8b";
  const moved = mkdtempSync(path.join(tmpdir(), "pass-art-"));
  mkdirSync(path.join(moved, "pass"));
  writeFileSync(path.join(moved, "pass", "index.json"), JSON.stringify({ art: { 21: { file: MOVED, color: "#5a7a3c" }, 1: { file: A, color: null } } }));

  it("are written by the pictures' file names, each box [left, top, width, height] never zoomed, nothing showing below", () => {
    expect(Object.keys(frames).length).toBeGreaterThan(0);
    for (const [file, frame] of Object.entries(frames)) {
      expect(file).toMatch(/^[0-9a-f]{16}$/);
      expect(Object.keys(frame).length, file).toBeGreaterThan(0);
      for (const [where, box] of Object.entries(frame) as [string, ArtBox][]) {
        const at = `${file} ${where}`;
        expect(["m", "f", "p"], at).toContain(where);
        expect(box, at).toHaveLength(4);
        expect(box.every(Number.isFinite), at).toBe(true);
        const [, top, width, height] = box;
        // as big as filling the box makes it (100% one way, more the other), only moved
        expect(Math.min(width, height), at).toBe(100);
        expect(top, at).toBeLessThanOrEqual(0);
        expect(top + height, at).toBeGreaterThanOrEqual(100 - 1e-9);
      }
    }
    expect(frames[MOVED]).toEqual({ m: [0, -13.8, 100, 140.4], f: [0, -20.3, 100, 207.8], p: [0, -16.7, 100, 170.2] });
  });

  it("go with those pictures alone, and with none while PASS_FRAMING is off", async () => {
    const art = await load({ OPERATOR_ART_DIR: moved });
    expect(await art.passArtList()).toEqual({ 21: [MOVED, "#5a7a3c", frames[MOVED]], 1: [A, null] });
    expect(art.artFrame(MOVED)).toEqual(frames[MOVED]);
    for (const none of [A, null, undefined, "", MOVED.toUpperCase()]) expect(art.artFrame(none), String(none)).toBeNull();

    const off = await load({ OPERATOR_ART_DIR: moved, PASS_FRAMING: "off" });
    expect(await off.passArtList()).toEqual({ 21: [MOVED, "#5a7a3c"], 1: [A, null] });
    expect(off.artFrame(MOVED)).toBeNull();
  });
});
