import { describe, expect, it } from "vitest";
import { ROACH_AVATARS } from "../types";
import { addToSnapshot, emptySnapshot } from "./siInk";

const inks = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ no: from + i, look: "hood" }));

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
    addToSnapshot(s, [{ no: 1024, look: "gugu" }], []);
    expect(s.lastNo).toBe(1024);
    expect(s.look[1024]).toBe(ROACH_AVATARS.indexOf("gugu"));
    expect(s.ticket[1024]).toBe(1);
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
