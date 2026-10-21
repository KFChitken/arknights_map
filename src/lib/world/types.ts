import type { Declaration } from "../declarations";
import type { Profile, PublicProfile } from "../profile";
import type { LngLat, RoachColor } from "../types";

/**
 * The data layer the UI talks to. Today it is backed by the browser
 * (./local.ts); a server version only has to implement this interface with
 * the same rules, so nothing in the UI changes.
 */
export interface World {
  /** The player this browser is acting as, with their own roaches at true positions. */
  me(): Promise<Me>;
  /** Everyone else's roaches: fuzzed positions, no owner, random order. */
  roaches(): Promise<PublicRoach[]>;
  saveProfile(profile: Profile): Promise<Profile>;
  /** Place or move a roach. Returns the owner's roaches afterwards. */
  placeRoach(target: PlaceTarget, at: LngLat): Promise<OwnRoach[]>;
  /** Taking back the main roach takes back the clones too. */
  removeRoach(roachId: string): Promise<OwnRoach[]>;
  /** Touch someone else's roach by its public id. */
  touch(publicId: string, bold: boolean): Promise<TouchResult>;
  /** Touch back whoever sent an inbox item. */
  reply(itemId: string, bold: boolean): Promise<TouchResult>;
  inbox(): Promise<InboxItem[]>;
  markSeen(itemIds: string[]): Promise<void>;
  /** Shout to every player with a roach within the radius of your main roach. */
  declare(d: Declaration): Promise<{ reach: string }>;
  /** 触须之交: players you and they have both touched boldly. */
  friends(): Promise<Friend[]>;
  unfriend(friendId: string): Promise<void>;

  // Local testing only: step into other players' shoes on one device
  identities(): Promise<Identity[]>;
  become(id: PlayerId): Promise<void>;
  reset(): Promise<void>;
}

export type PlayerId = string;

export type PlaceTarget = { kind: "main" } | { kind: "clone" } | { kind: "move"; roachId: string };

/** One of your own roaches at its true position. Only its owner ever gets this. */
export type OwnRoach = LngLat & { id: string; slot: number };

/** Someone else's roach as you see it. friend: it belongs to one of your 触须之交. */
export type PublicRoach = LngLat & { id: string; clone: boolean; color: RoachColor; friend: boolean };

/** newFriend: the other player's name when this touch made you 触须之交 */
export type TouchResult = { newFriend: string | null };

export type Friend = {
  /** Opaque; only good for unfriending */
  id: string;
  since: number;
  profile: PublicProfile;
  /** Their main roach and clones, fuzzed like everyone else's */
  roaches: PublicRoach[];
  /** Declarations in the last INBOX_DAYS */
  declarations: number;
  /** Their recent activity, newest first. Other players in it stay anonymous unless it is you. */
  history: FriendEvent[];
};

export type FriendEvent =
  | { kind: "touched" | "touchedBy"; at: number; bold: boolean; you: boolean }
  | { kind: "declared"; at: number; text: string }
  | { kind: "befriended"; at: number; you: boolean };

export type Me = { id: PlayerId; profile: Profile; roaches: OwnRoach[] };

export type InboxItem =
  | {
      kind: "touch";
      id: string;
      at: number;
      seen: boolean;
      bold: boolean;
      /** What of yours it answers: a roach, or your own earlier touch or declaration */
      target: "main" | "clone" | "touch" | "declaration";
      /** Only for bold touches */
      from: PublicProfile | null;
      replied: boolean;
    }
  | { kind: "declaration"; id: string; at: number; seen: boolean; text: string; replied: boolean }
  | { kind: "friend"; id: string; at: number; seen: boolean; from: PublicProfile; friendId: string; replied: boolean };

export type Identity = {
  id: PlayerId;
  label: string;
  note: string;
  unseen: number;
  current: boolean;
  group: "me" | "tester" | "passerby";
};

/** A refusal whose message can be shown to the player as is. */
export class WorldError extends Error {}
