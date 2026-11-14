import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoachPass } from "@/lib/passes";
import { passesApi } from "@/lib/passesClient";
import { SI_ID } from "@/lib/si";
import { askRoachPass, forgetRoachPassesHere, heardRoachPass, passCardRoach } from "./RoachPass";

const PASS: RoachPass = { charId: 1, name: "能天使", rarity: 6, color: "#d63829", art: null };

beforeEach(() => forgetRoachPassesHere());
afterEach(() => vi.restoreAllMocks());

describe("the pass on a roach's card, as the page asks for it", () => {
  it("is asked once for a roach while its card opens and opens again, and kept a minute", async () => {
    const roach = vi.spyOn(passesApi, "roach").mockResolvedValue({ pass: PASS });
    expect(heardRoachPass("abcd1234")).toBeNull();
    // the card opened twice at once (and React's second go at an effect)
    await Promise.all([askRoachPass("abcd1234"), askRoachPass("abcd1234")]);
    expect(roach).toHaveBeenCalledTimes(1);
    expect(roach).toHaveBeenCalledWith("abcd1234");
    expect(heardRoachPass("abcd1234")).toEqual(PASS);
    await askRoachPass("abcd1234", Date.now() + 59_000);
    expect(roach).toHaveBeenCalledTimes(1);
    // a minute on, asked again; what was heard shows meanwhile
    roach.mockResolvedValue({ pass: null });
    const again = askRoachPass("abcd1234", Date.now() + 61_000);
    expect(heardRoachPass("abcd1234")).toEqual(PASS);
    await again;
    expect(roach).toHaveBeenCalledTimes(2);
    expect(heardRoachPass("abcd1234")).toBeNull();
    // each roach its own
    await askRoachPass("ffff0000");
    expect(roach).toHaveBeenLastCalledWith("ffff0000");
  });

  it("is asked only by a player 寻访 is open to, and only for another player's main roach", () => {
    const main = { id: "abcd1234", clone: false };
    expect(passCardRoach(true, main)).toBe("abcd1234");
    // while PASSES is admins, anyone else has no 寻访 (me.passes): they ask nothing, so see nothing
    expect(passCardRoach(false, main)).toBeNull();
    for (const not of [{ ...main, clone: true }, { ...main, guide: true as const }, { ...main, bot: true as const }, { id: SI_ID, clone: false }]) {
      expect(passCardRoach(true, not)).toBeNull();
    }
    // no card open, or the player's own roach
    expect(passCardRoach(true, null)).toBeNull();
    expect(passCardRoach(true, undefined)).toBeNull();
  });

  it("is nothing when it could not be had, and asked again the next time", async () => {
    const roach = vi.spyOn(passesApi, "roach").mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ pass: PASS });
    await expect(askRoachPass("abcd1234")).resolves.toBeUndefined();
    expect(heardRoachPass("abcd1234")).toBeNull();
    await askRoachPass("abcd1234");
    expect(roach).toHaveBeenCalledTimes(2);
    expect(heardRoachPass("abcd1234")).toEqual(PASS);
  });
});
