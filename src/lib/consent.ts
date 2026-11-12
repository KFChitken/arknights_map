import { fmt, T } from "@/i18n";
import { MIN_SIGNUP_AGE } from "./rules";

/**
 * The consents asked for on their own: at sign-up, again by older accounts after
 * the privacy policy changed (POLICY_UPDATED_AT), and before the first roach goes
 * down. Only the time of each is stored, never the words.
 */
export const adultTick = () => fmt(T.consent.adultTick, { age: MIN_SIGNUP_AGE });
export const crossBorderTick = () => T.consent.crossBorderTick;
export const publicPlaceTick = () => T.consent.publicPlaceTick;
/** Said once, before the first roach a player puts down */
export const publicPlaceNote = () => T.consent.publicPlaceNote;

export type Tick = "adult" | "acceptPolicy" | "acceptCrossBorder" | "acceptPublicPlace";

/** What the server says when a request leaves a tick out. */
export const TICK_MISSING: Record<Tick, string> = {
  get adult() {
    return fmt(T.consent.missing.adult, { age: MIN_SIGNUP_AGE });
  },
  get acceptPolicy() {
    return T.consent.missing.acceptPolicy;
  },
  get acceptCrossBorder() {
    return T.consent.missing.acceptCrossBorder;
  },
  get acceptPublicPlace() {
    return T.consent.missing.acceptPublicPlace;
  },
};

/**
 * The refusal (HTTP 428) while the admin waits for a player to say again they are 18 or older: its code
 * (beside its words, which are in the player's language), on which the page shows its card
 */
export const AGE_CHECK = "age";
export const ageCheckNeeded = () => T.consent.ageCheckNeeded;
