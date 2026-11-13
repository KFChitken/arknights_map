import { T } from "@/i18n";
import { AGE_CHECK, ageCheckNeeded } from "../consent";
import type { Declaration } from "../declarations";
import type { BatchAct, Gesture } from "../friendly";
import type { Game } from "../games";
import type { HelpAsk } from "../help";
import { heardGray } from "../grayMode";
import { heardNoticeStamp } from "../notices";
import type { Profile } from "../profile";
import type { ReportReason, RoachReportReason } from "../safety";
import type { LngLat } from "../types";
import { boxText, type Area, type Box } from "./area";
import {
  AgeCheckNeeded,
  ConsentNeeded,
  SignInNeeded,
  TooBusy,
  WorldError,
  type BlockedPlayer,
  type Friend,
  type HelpBoard,
  type Identity,
  type InboxItem,
  type InkTap,
  type Me,
  type MingheItem,
  type OwnRoach,
  type PerlicaItem,
  type PlaceTarget,
  type PlayerId,
  type PretendWhat,
  type Radar,
  type RideTarget,
  type AreaUpdate,
  type RoachFeedUpdate,
  type VisitorFeed,
  type TouchResult,
  type World,
} from "./types";

/** The World backed by the server (src/app/api/world/[op]). */
export class ServerWorld implements World {
  private async call<T>(op: string, ...args: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`/api/world/${op}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args }),
      });
    } catch {
      throw new WorldError(T.requests.offline);
    }
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string; code?: string } | null;
    if (res.status === 401) throw new SignInNeeded(body?.error ?? T.requests.signIn);
    if (res.status === 428 && body?.code === AGE_CHECK) throw new AgeCheckNeeded(ageCheckNeeded());
    if (res.status === 428) throw new ConsentNeeded(body?.error ?? T.requests.reconsent);
    if (!res.ok) throw new WorldError(body?.error ?? T.requests.serverTrouble);
    return body?.result as T;
  }

  // the zone only works out which day it is for 阿米娅向导's greeting; the server keeps none of it
  me = () => this.call<Me | null>("me", new Date().getTimezoneOffset());
  here = () => this.call<PerlicaItem | null>("here");
  // as the page goes, so a beacon: it outlives the page, and nobody waits for an answer
  leave = () => {
    const body = JSON.stringify({ args: [] });
    try {
      if (navigator.sendBeacon?.("/api/world/leave", body)) return;
    } catch {}
    fetch("/api/world/leave", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(
      () => {},
    );
  };
  setPerlicaTimer = (on: boolean) => this.call<void>("setPerlicaTimer", on);
  setOnlyMains = (on: boolean) => this.call<void>("setOnlyMains", on);
  // A GET, so a browser that already holds the whole snapshot gets a 304 for it; f=3: packed, and with short ids
  roachFeed = async (since: string | null): Promise<RoachFeedUpdate | VisitorFeed> => {
    let res: Response;
    try {
      res = await fetch(since ? `/api/roaches?since=${encodeURIComponent(since)}&f=3` : "/api/roaches?f=3", {
        cache: since ? "no-store" : "no-cache",
      });
    } catch {
      throw new WorldError(T.requests.offline);
    }
    // which notices there are now (公告): the page asks for them only when they are not the ones it holds; and
    // whether the site is gray (全站变灰)
    heardNoticeStamp(res.headers.get("x-notices"));
    heardGray(res.headers.get("x-gray"));
    const body = (await res.json().catch(() => null)) as ((RoachFeedUpdate | VisitorFeed) & { error?: string }) | null;
    if (res.status === 429) throw new TooBusy(body?.error ?? T.requests.busy, Number(res.headers.get("retry-after")) || 10);
    if (!res.ok || !body) throw new WorldError(body?.error ?? T.requests.serverTrouble);
    return body;
  };
  // f=4: an area only (world/area.ts); a whole one by ETag, so the same one again costs a 304
  // "counts": how many there are only (t), for 全员隐匿, which draws nobody's roaches
  // mains: the overview of main roaches only (只看本体); boxes the page picks over itself
  roachArea = async (area: Area | "counts", since: string | null, mains = false): Promise<AreaUpdate | VisitorFeed> => {
    // the overview with each roach as its square (o=2: a fraction of the bytes, drawn at the square's middle)
    const where = area === "counts" ? "c=1" : area === "overview" ? `o=2${mains ? "&m=1" : ""}` : `box=${boxText(area)}`;
    const url = `/api/roaches?f=4&${where}${since ? `&since=${encodeURIComponent(since)}` : ""}`;
    const ask = async (cache: RequestCache) => {
      try {
        const res = await fetch(url, { cache });
        heardNoticeStamp(res.headers.get("x-notices"));
        heardGray(res.headers.get("x-gray"));
        return { res, body: (await res.json().catch(() => null)) as ((AreaUpdate | VisitorFeed) & { error?: string }) | null };
      } catch {
        throw new WorldError(T.requests.offline);
      }
    };
    let { res, body } = await ask(since ? "no-store" : "no-cache");
    // An area whole that the browser could not hand over from what it holds (a bare 304, or a copy it cannot
    // read): once more, from the server
    if (!since && (res.status === 304 || (res.ok && !body))) ({ res, body } = await ask("reload"));
    if (res.status === 429) throw new TooBusy(body?.error ?? T.requests.busy, Number(res.headers.get("retry-after")) || 10);
    if (!res.ok || !body) throw new WorldError(body?.error ?? T.requests.serverTrouble);
    return body;
  };
  // Exactly how many roaches there are in a view, for a map showing the overview (its roaches stand at the middle
  // of their squares, each for all in it, so counted by them the view's edges cut squares in two)
  // mains: how many players' main roaches (只看本体)
  roachesInView = async (view: Box, mains = false): Promise<{ n: number } | VisitorFeed | { whole: true }> => {
    const res = await fetch(`/api/roaches?f=4&n=${view.map((x) => +x.toFixed(7)).join(",")}${mains ? "&m=1" : ""}`, { cache: "no-store" });
    heardNoticeStamp(res.headers.get("x-notices"));
    heardGray(res.headers.get("x-gray"));
    const body = (await res.json().catch(() => null)) as ({ n: number } | VisitorFeed | { whole: true }) | null;
    if (!res.ok || !body) throw new WorldError(T.requests.serverTrouble);
    return body;
  };
  // the spot to two places of a degree: the server counts no finer, so nothing finer is sent
  around = async (spot: LngLat, signal?: AbortSignal) => {
    const res = await fetch(`/api/around?lng=${spot.lng.toFixed(2)}&lat=${spot.lat.toFixed(2)}`, { signal, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { near: number; far: number; error?: string } | null;
    if (!res.ok || !body) throw new WorldError(body?.error ?? T.requests.serverTrouble);
    return { near: body.near, far: body.far };
  };
  saveProfile = (p: Profile) => this.call<Profile>("saveProfile", p);
  placeRoach = (target: PlaceTarget, at: LngLat) => this.call<OwnRoach[]>("placeRoach", target, at);
  sitByFire = (target: PlaceTarget) => this.call<{ roaches: OwnRoach[]; seat: LngLat }>("sitByFire", target);
  acceptPublicPlace = () => this.call<void>("acceptPublicPlace");
  rideMinghe = (target: RideTarget) => this.call<{ roaches: OwnRoach[]; item: MingheItem }>("rideMinghe", target);
  dismountMinghe = () => this.call<{ roaches: OwnRoach[]; item: MingheItem }>("dismountMinghe");
  siPortrait = (choice: "return" | "keep") => this.call<{ line: string }>("siPortrait", choice);
  tapInk = (ink: { x: number; y: number; tap: number; fx: number; fy: number }) =>
    this.call<InkTap>("tapInk", ink.x, ink.y, ink.tap, ink.fx, ink.fy);
  recallInk = () => this.call<void>("recallInk");
  drink = () => this.call<{ until: number }>("drink");
  sober = () => this.call<void>("sober");
  partied = () => this.call<void>("partied");
  removeRoach = (roachId: string) => this.call<OwnRoach[]>("removeRoach", roachId);
  // the zone only says which day it is for 佩丽卡监督's count of the day
  touch = (publicId: string, bold: boolean) => this.call<TouchResult>("touch", publicId, bold, new Date().getTimezoneOffset());
  reply = (itemId: string, bold: boolean) => this.call<TouchResult>("reply", itemId, bold, new Date().getTimezoneOffset());
  poke = (publicId: string) => this.call<{ againAt: number }>("poke", publicId);
  remindSanity = (friendId: string) => this.call<void>("remindSanity", friendId);
  answerSanity = (itemId: string, answer: "done" | "ok") => this.call<void>("answerSanity", itemId, answer);
  gesture = (friendId: string, gesture: Gesture, replyTo?: string) => this.call<void>("gesture", friendId, gesture, replyTo ?? null);
  visit = (friendId: string, publicId: string, cloneId?: string) =>
    this.call<{ roaches: OwnRoach[]; seat: LngLat }>("visit", friendId, publicId, cloneId ?? null);
  goHome = (cloneId: string) => this.call<OwnRoach[]>("goHome", cloneId);
  followHost = (cloneId: string) => this.call<{ roaches: OwnRoach[]; seat: LngLat }>("followHost", cloneId);
  sendHome = (friendId: string) => this.call<void>("sendHome", friendId);
  gameAsk = (friendId: string, game: Game) => this.call<void>("gameAsk", friendId, game);
  gameAdded = (itemId: string) => this.call<void>("gameAdded", itemId);
  gameWant = (friendId: string, game: Game) => this.call<void>("gameWant", friendId, game);
  friendsAct = (act: BatchAct, friendIds: string[]) => this.call<{ id: string; ok: boolean; why?: string }[]>("friendsAct", act, friendIds);
  starFriend = (friendId: string, on: boolean) => this.call<void>("starFriend", friendId, on);
  helpBoard = () => this.call<HelpBoard>("helpBoard");
  seeHelp = () => this.call<void>("seeHelp");
  askHelp = (ask: HelpAsk) => this.call<void>("askHelp", ask);
  closeHelp = (requestId: string) => this.call<void>("closeHelp", requestId);
  answerHelp = (requestId: string, clues?: number[]) => this.call<void>("answerHelp", requestId, clues ?? null);
  inbox = () => this.call<InboxItem[]>("inbox");
  newDeclarations = (after: number) => this.call<InboxItem[]>("newDeclarations", after);
  markSeen = (itemIds: string[]) => this.call<void>("markSeen", itemIds);
  declare = (d: Declaration, from?: string[]) => this.call<{ reach: string }>("declare", d, from);
  react = (itemId: string, reaction: string) => this.call<void>("react", itemId, reaction);
  ignore = (itemId: string) => this.call<void>("ignore", itemId);
  friends = () => this.call<Friend[]>("friends");
  unfriend = (friendId: string) => this.call<void>("unfriend", friendId);
  radar = () => this.call<Radar | null>("radar");
  block = (target: string) => this.call<void>("block", target);
  unblock = (blockId: string) => this.call<void>("unblock", blockId);
  blocks = () => this.call<BlockedPlayer[]>("blocks");
  report = (target: string, reason: ReportReason, note: string) => this.call<void>("report", target, reason, note);
  reportRoach = (roachId: string, reason: RoachReportReason, note: string) => this.call<void>("reportRoach", roachId, reason, note);
  appeal = (actionId: string, text: string) => this.call<void>("appeal", actionId, text);
  wearBadge = (badge: string | null) => this.call<void>("wearBadge", badge);
  seeBadges = (badges: string[]) => this.call<void>("seeBadges", badges);
  identities = () => this.call<Identity[]>("identities");
  become = (id: PlayerId) => this.call<void>("become", id);
  reset = () => this.call<void>("reset");
  pretend = (what: PretendWhat, seconds?: number) => this.call<void>("pretend", what, seconds);
  confirmAge = () => this.call<void>("confirmAge");
}
