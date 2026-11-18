import { T } from "@/i18n";
import { AgeCheckNeeded, ConsentNeeded, SignInNeeded, WorldError } from "@/lib/world/types";

/** The refusals the map page answers itself: sign in, say again they are 18, agree to the updated privacy policy */
export const mapsOwn = (e: unknown) => e instanceof SignInNeeded || e instanceof AgeCheckNeeded || e instanceof ConsentNeeded;

/** What to say of any other refusal */
export function sayWhy(e: unknown): string {
  if (e instanceof WorldError) return e.message;
  console.error(e);
  return T.map.common.tryAgain;
}
