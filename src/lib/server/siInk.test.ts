import { describe, expect, it } from "vitest";
import { ROACH_AVATARS } from "../types";
import { addToSnapshot, emptySnapshot } from "./siInk";

/** An ink as read from si_inks: on the map, changed as it was drawn */
const ink = (no: number, look = "hood", held = false) => ({
  no,
  look,
  publicId: `00000000-0000-4000-8000-${String(no).padStart(12, "0")}`,
  held,
  sealed: false,
  changed: no,
});
const inks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ink(from + i));

describe("the ink snapshot", () => {
  it("keeps a ticket read before its ink, even past the room held so far", () => {
    const s = emptySnapshot();
    addToSnapshot(s, inks(1, 1023), []);
    expect(s.ticket.length).toBe(1024);
    // ink 1024's first ticket, read a moment before ink 1024 itself
    addToSnapshot(s, [], [{ n: 1, inkNo: 1024, checkinAt: new Date(5_000) }]);
    expect(s.ticket[1024]).toBe(1);
    expect(s.checkin[1]).toBe(5);
    expect(s.lastNo).toBe(1023);
    expect(s.lastN).toBe(1);
    addToSnapshot(s, [ink(1024, "gugu")], []);
    expect(s.lastNo).toBe(1024);
    expect(s.look[1024]).toBe(ROACH_AVATARS.indexOf("gugu"));
    expect(s.ticket[1024]).toBe(1);
    expect(s.sealed[1024]).toBe(0);
    // its owner's 集章本 full: read again as changed, now with her seal
    addToSnapshot(s, [{ ...ink(1024, "gugu"), sealed: true, changed: 2000 }], []);
    expect(s.sealed[1024]).toBe(1);
    expect(s.sealed[1023]).toBe(0);
    expect(s.lastChanged).toBe(2000);
  });

  it("holds an ink's latest ticket, and grows to take thousands at once", () => {
    const s = emptySnapshot();
    const tickets = Array.from({ length: 5000 }, (_, i) => ({ n: i + 1, inkNo: (i % 2500) + 1, checkinAt: new Date((i + 1) * 1000) }));
    addToSnapshot(s, inks(1, 2500), tickets);
    expect(s.lastNo).toBe(2500);
    expect(s.lastN).toBe(5000);
    expect(s.ticket[1]).toBe(2501);
    expect(s.ticket[2500]).toBe(5000);
    expect(s.checkin[5000]).toBe(5000);
  });
});
