import "server-only";
import type { Game } from "../games";
import { isModHere, isOwnerEmail } from "./admins";
import { squadMode } from "./env";
import type { UserRow } from "./schema";

/** Whether 一起卫戍 is open to this player: SQUAD=on, everyone; admins, the 站长 and the admins; off, nobody */
export function squadOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = squadMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/** Whether its way in shows to them: open to them, and they play 明日方舟 (or no game yet), not 终末地 alone */
export function squadShown(user: Pick<UserRow, "id" | "email" | "games">): boolean {
  const games = user.games as Game[];
  return squadOpen(user) && !(games.length === 1 && games[0] === "endfield");
}
