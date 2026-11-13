import { describe, expect, it } from "vitest";
import { decodeInk, encodeInk, INK_BYTES, oldTile, OLD_INK_BYTES, type InkCell } from "./siTiles";

describe("an ink roach's bytes", () => {
  it("carry her seal in a bit of their own, leaving what pages from before it read as it was", () => {
    const cell: InkCell = { fx: 0.25, fy: 0.75, look: 4, state: 2, left: true, sealed: false, size: 1, tilt: 2, ink: 0.85, tap: 0xdeadbeef };
    const plain = new Uint8Array(INK_BYTES);
    const sealed = new Uint8Array(INK_BYTES);
    encodeInk(plain, 0, cell);
    encodeInk(sealed, 0, { ...cell, sealed: true });
    expect(decodeInk(plain, 0)).toMatchObject({ look: 4, state: 2, left: true, sealed: false, tap: 0xdeadbeef });
    expect(decodeInk(sealed, 0)).toMatchObject({ look: 4, state: 2, left: true, sealed: true, tap: 0xdeadbeef });
    // one bit apart, in the byte of look, state and way
    expect([...sealed].map((v, i) => v ^ plain[i])).toEqual([0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 0, 0]);
    expect(oldTile(sealed)).toHaveLength(OLD_INK_BYTES);
  });
});
