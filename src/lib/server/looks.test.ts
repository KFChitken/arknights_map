import { afterEach, describe, expect, it, vi } from "vitest";
import { ROACH_AVATARS } from "../types";
import { drawnLook, duckShownBetween, duckShownTo, ducksSeenAmong, lookToSave, mayWearDuck, ownLook, pickableLooks, SPONSOR_BADGE } from "./looks";

vi.mock("./env", async (original) => ({ ...(await original<typeof import("./env")>()), ADMIN_EMAILS: ["owner@example.com"] }));
// an admin, as this process knows them (admins.ts)
vi.mock("./admins", async (original) => ({ ...(await original<typeof import("./admins")>()), isModHere: (id: string) => id === "mod" }));

afterEach(() => {
  vi.unstubAllEnvs();
});

const OWNER = { id: "owner", email: "owner@example.com" };
const MOD = { id: "mod", email: "mod@example.com" };
/** holds 服务器饲养员 (given as FEEDER_BADGES) */
const FEEDER = { id: "feeder", email: "feeder@example.com" };
const PLAYER = { id: "player", email: "me@example.com" };
const FEEDER_BADGES = ["volt", SPONSOR_BADGE];
const withoutDuck = ROACH_AVATARS.filter((a) => a !== "duck");
const every = [...ROACH_AVATARS];

describe("鸭爵, the thanks for sponsoring, as DUCK has him", () => {
  it("is nobody's to pick while off, the default, and the plain hood everywhere, kept as he was for when he shows", async () => {
    expect(ROACH_AVATARS.at(-1)).toBe("duck");
    expect(SPONSOR_BADGE).toBe("feeder");
    for (const who of [OWNER, MOD, FEEDER, PLAYER]) expect(pickableLooks(who, FEEDER_BADGES)).toEqual(withoutDuck);
    expect(drawnLook("duck")).toBe("hood");
    expect(ownLook({ ...OWNER, avatar: "duck" })).toBe("hood");
    expect([OWNER, MOD, FEEDER, PLAYER, null].map(duckShownTo)).toEqual([false, false, false, false, false]);
    expect([OWNER, MOD, FEEDER, PLAYER, null].map((viewer) => duckShownBetween(viewer, MOD))).toEqual([false, false, false, false, false]);
    expect(await ducksSeenAmong("mod", [{ ...OWNER, avatar: "duck" }, { ...MOD, avatar: "duck" }])).toEqual(new Set());
    expect(drawnLook("imp")).toBe("imp");
    expect(drawnLook("penguin")).toBe("hood");
    expect(drawnLook(null)).toBe("hood");
    // a profile saved in the hood he shows as (or in him, from a page opened before) keeps him
    expect(lookToSave("hood", "duck", OWNER, [])).toBe("duck");
    expect(lookToSave("duck", "duck", FEEDER, FEEDER_BADGES)).toBe("duck");
    // another look is picked as ever, and nobody puts him on
    expect(lookToSave("imp", "duck", MOD, [])).toBe("imp");
    expect(lookToSave("duck", "imp", OWNER, [])).toBe("imp");
    expect(lookToSave("duck", null, OWNER, [])).toBe("hood");
    // one he is not for loses him
    expect(lookToSave("hood", "duck", PLAYER, [])).toBe("hood");
    // anything else DUCK says is off
    vi.stubEnv("DUCK", "yes");
    expect(pickableLooks(OWNER, [])).toEqual(withoutDuck);
    expect(drawnLook("duck")).toBe("hood");
  });

  it("is the 站长's and the admins' alone while admins, and shows only among them", async () => {
    vi.stubEnv("DUCK", "admins");
    expect(pickableLooks(OWNER, [])).toEqual(every);
    expect(pickableLooks(MOD, [])).toEqual(every);
    // a 服务器饲养员 waits for DUCK=on
    expect(pickableLooks(FEEDER, FEEDER_BADGES)).toEqual(withoutDuck);
    expect(pickableLooks(PLAYER, [])).toEqual(withoutDuck);
    // they see themselves and one another in him; the shared feed, and anyone else, the hood
    expect(ownLook({ ...OWNER, avatar: "duck" })).toBe("duck");
    expect(ownLook({ ...MOD, avatar: "duck" })).toBe("duck");
    expect(drawnLook("duck")).toBe("hood");
    expect([OWNER, MOD, FEEDER, PLAYER, null].map(duckShownTo)).toEqual([true, true, false, false, false]);
    expect([OWNER, MOD, FEEDER, PLAYER, null].map((viewer) => duckShownBetween(viewer, OWNER))).toEqual([true, true, false, false, false]);
    expect([OWNER, MOD, FEEDER, PLAYER, null].map((viewer) => duckShownBetween(viewer, MOD))).toEqual([true, true, false, false, false]);
    // one in him who is no admin is the hood to all meanwhile, as to themselves
    expect([OWNER, MOD, FEEDER, PLAYER, null].map((viewer) => duckShownBetween(viewer, FEEDER))).toEqual([false, false, false, false, false]);
    const wearing = [
      { ...OWNER, avatar: "duck" },
      { ...MOD, avatar: "duck" },
      { ...FEEDER, avatar: "duck" },
      { ...PLAYER, avatar: "imp" },
    ];
    expect(await ducksSeenAmong("mod", wearing)).toEqual(new Set(["owner", "mod"]));
    expect(await ducksSeenAmong(null, wearing)).toEqual(new Set());
    // no admin in him: nobody need be asked who they are
    expect(await ducksSeenAmong("not-even-an-id", wearing.slice(2))).toEqual(new Set());
    expect(lookToSave("duck", "hood", OWNER, [])).toBe("duck");
    expect(lookToSave("duck", "imp", MOD, [])).toBe("duck");
    expect(lookToSave("hood", "duck", MOD, [])).toBe("hood");
    // asked for all the same: the look they had stays, or the plain hood
    expect(lookToSave("duck", "imp", PLAYER, [])).toBe("imp");
    expect(lookToSave("duck", null, FEEDER, FEEDER_BADGES)).toBe("hood");
    // a 服务器饲养员 who put him on while he was on keeps him, seeing the hood meanwhile
    expect(ownLook({ ...FEEDER, avatar: "duck" })).toBe("hood");
    expect(lookToSave("hood", "duck", FEEDER, FEEDER_BADGES)).toBe("duck");
    expect(lookToSave("gugu", "duck", FEEDER, FEEDER_BADGES)).toBe("gugu");
  });

  it("is a 服务器饲养员's to pick too while on, and everyone sees him", async () => {
    vi.stubEnv("DUCK", "on");
    expect(pickableLooks(FEEDER, FEEDER_BADGES)).toEqual(every);
    expect(pickableLooks(OWNER, [])).toEqual(every);
    expect(pickableLooks(MOD, [])).toEqual(every);
    expect(pickableLooks(PLAYER, ["beta", "volt"])).toEqual(withoutDuck);
    expect(drawnLook("duck")).toBe("duck");
    expect(duckShownTo(null)).toBe(true);
    expect([OWNER, PLAYER, null].map((viewer) => duckShownBetween(viewer, FEEDER))).toEqual([true, true, true]);
    expect(await ducksSeenAmong(null, [{ ...PLAYER, avatar: "duck" }, { ...FEEDER, avatar: "hood" }])).toEqual(new Set(["player"]));
    expect(ownLook({ ...PLAYER, avatar: "duck" })).toBe("duck");
    expect(lookToSave("duck", "imp", FEEDER, FEEDER_BADGES)).toBe("duck");
    expect(lookToSave("duck", "imp", PLAYER, [])).toBe("imp");
    expect(lookToSave("duck", "penguin", PLAYER, [])).toBe("hood");
    expect(lookToSave("doctor", "duck", FEEDER, FEEDER_BADGES)).toBe("doctor");
    // the badge gone (and no admin), he goes with it
    expect(lookToSave("duck", "duck", FEEDER, ["volt"])).toBe("hood");
    expect([mayWearDuck(FEEDER, ["volt"]), mayWearDuck(FEEDER, FEEDER_BADGES), mayWearDuck(MOD, []), mayWearDuck(OWNER, [])]).toEqual([
      false,
      true,
      true,
      true,
    ]);
  });
});
