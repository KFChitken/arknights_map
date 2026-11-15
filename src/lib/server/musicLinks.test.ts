import { describe, expect, it } from "vitest";
import { LINK_MAX_S, linkExpiry, linkGood, musicLink } from "./musicLinks";

const FILE = "0123456789abcdef.m4a";
const OTHER = "fedcba9876543210.m4a";
const HOUR = 3_600_000;
/** A moment at the start of a 6-hour block (Unix time is in whole blocks from 1970), and one later in it */
const BLOCK = Date.UTC(2026, 10, 15, 6);
const LATER = BLOCK + 5 * HOUR + 59 * 60_000;

const parts = (link: string) => {
  const m = /^\/music\/([0-9a-f]{16}\.m4a)\?k=(\d+)\.([A-Za-z0-9_-]{22})$/.exec(link);
  if (!m) throw new Error(`not a link: ${link}`);
  return { file: m[1], exp: Number(m[2]), sig: m[3] };
};

describe("听歌's song links", () => {
  it("last until the end of the 6-hour block they are given in, and 6 hours more", () => {
    expect(linkExpiry(BLOCK)).toBe(BLOCK / 1000 + 12 * 3600);
    expect(linkExpiry(LATER)).toBe(BLOCK / 1000 + 12 * 3600);
    expect(linkExpiry(BLOCK + 6 * HOUR)).toBe(BLOCK / 1000 + 18 * 3600);
    // so a link is good for 6 to 12 hours, never more
    expect(linkExpiry(BLOCK) - BLOCK / 1000).toBe(LINK_MAX_S);
    expect(linkExpiry(LATER) - LATER / 1000).toBeGreaterThan(6 * 3600);
  });

  it("are the same for everyone all through a block, so a browser's copy of a song is used again", () => {
    expect(musicLink(FILE, BLOCK)).toBe(musicLink(FILE, LATER));
    expect(musicLink(FILE, BLOCK)).not.toBe(musicLink(FILE, BLOCK + 6 * HOUR));
    expect(musicLink(FILE, BLOCK)).not.toBe(musicLink(OTHER, BLOCK));
    expect(parts(musicLink(FILE, BLOCK))).toMatchObject({ file: FILE, exp: linkExpiry(BLOCK) });
  });

  it("are good until they expire, and only as given", () => {
    const link = musicLink(FILE, BLOCK);
    const { exp, sig } = parts(link);
    expect(linkGood(link, BLOCK)).toBe(true);
    expect(linkGood(link, LATER)).toBe(true);
    expect(linkGood(link, exp * 1000 - 1)).toBe(true);
    // expired
    expect(linkGood(link, exp * 1000)).toBe(false);
    expect(linkGood(link, exp * 1000 + HOUR)).toBe(false);
    // an expiry moved, the other file's name with this signature, a signature changed
    expect(linkGood(`/music/${FILE}?k=${exp + 6 * 3600}.${sig}`, BLOCK)).toBe(false);
    expect(linkGood(`/music/${FILE}?k=${exp - 6 * 3600}.${sig}`, BLOCK)).toBe(false);
    expect(linkGood(`/music/${OTHER}?k=${exp}.${sig}`, BLOCK)).toBe(false);
    const flipped = `${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
    expect(linkGood(`/music/${FILE}?k=${exp}.${flipped}`, BLOCK)).toBe(false);
    // more than 12 hours ahead, even signed: never given, so never good
    const far = musicLink(FILE, BLOCK + 24 * HOUR);
    expect(linkGood(far, BLOCK)).toBe(false);
    expect(linkGood(far, BLOCK + 24 * HOUR)).toBe(true);
  });

  it("are never good for a path that is not one", () => {
    const link = musicLink(FILE, BLOCK);
    const { exp, sig } = parts(link);
    for (const uri of [
      "",
      `/music/${FILE}`,
      `/music/${FILE}?k=`,
      `/music/${FILE}?k=${exp}`,
      `/music/${FILE}?k=${exp}.${sig}&x=1`,
      `/music/${FILE}?x=1&k=${exp}.${sig}`,
      `/music/${FILE.toUpperCase()}?k=${exp}.${sig}`,
      `/music/../${FILE}?k=${exp}.${sig}`,
      `/music/sub/${FILE}?k=${exp}.${sig}`,
      `/tiles/${FILE}?k=${exp}.${sig}`,
      `${link}#x`,
      ` ${link}`,
    ]) {
      expect(linkGood(uri, BLOCK), uri).toBe(false);
    }
  });

  it("are only made for a song's file", () => {
    expect(() => musicLink("catalog.json", BLOCK)).toThrow();
    expect(() => musicLink("../etc/passwd", BLOCK)).toThrow();
  });
});
