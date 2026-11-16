import "server-only";
import { isModHere, isOwnerEmail } from "./admins";
import { recordsMode } from "./env";
import type { UserRow } from "./schema";

/** Whether 「我的记录」 is open to this player: RECORDS=on, everyone; admins, the 站长 and the admins; off, nobody */
export function recordsOpen(user: Pick<UserRow, "id" | "email">): boolean {
  const mode = recordsMode();
  return mode === "on" || (mode === "admins" && (isOwnerEmail(user.email) || isModHere(user.id)));
}
