import { sceneOf } from "@/lib/squad";
import { sceneA } from "./a";
import { sceneB } from "./b";
import { sceneC } from "./c";
import type { SceneApi, SceneOpts } from "./kit";

export type { FightMember, SceneApi, SceneOpts } from "./kit";

/**
 * The fight drawn over the map while a round of the room plays (step 5): A, B or C, the one the room and the round's
 * start pick (src/lib/squad.ts sceneOf), so the four in it see the same one.
 */
export function makeScene(stage: HTMLElement, opt: SceneOpts, roomId: string, wentAt: number): SceneApi {
  const v = sceneOf(roomId, wentAt);
  stage.classList.remove("mode-a", "mode-b", "mode-c", "quake", "glitchall", "freeze");
  stage.classList.add(v === 1 ? "mode-b" : v === 2 ? "mode-c" : "mode-a");
  return (v === 1 ? sceneB : v === 2 ? sceneC : sceneA)(stage, opt);
}
