import type { Declaration, Reaction } from "../declarations";
import type { Profile } from "../profile";
import type { ReportReason } from "../safety";
import type { LngLat } from "../types";
import {
  SignInNeeded,
  TooBusy,
  WorldError,
  type BlockedPlayer,
  type Friend,
  type Identity,
  type InboxItem,
  type Me,
  type OwnRoach,
  type PlaceTarget,
  type PlayerId,
  type Radar,
  type RoachFeedUpdate,
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
      throw new WorldError("连不上服务器，检查一下网络再试。");
    }
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (res.status === 401) throw new SignInNeeded(body?.error ?? "请先登录。");
    if (!res.ok) throw new WorldError(body?.error ?? "服务器出了点问题，稍后再试试。");
    return body?.result as T;
  }

  me = () => this.call<Me | null>("me");
  // A GET, so a browser that already holds the whole snapshot gets a 304 for it
  roachFeed = async (since: string | null): Promise<RoachFeedUpdate> => {
    let res: Response;
    try {
      res = await fetch(since ? `/api/roaches?since=${encodeURIComponent(since)}` : "/api/roaches", {
        cache: since ? "no-store" : "no-cache",
      });
    } catch {
      throw new WorldError("连不上服务器，检查一下网络再试。");
    }
    const body = (await res.json().catch(() => null)) as (RoachFeedUpdate & { error?: string }) | null;
    if (res.status === 429) throw new TooBusy(body?.error ?? "人有点多，几秒后自动重试。", Number(res.headers.get("retry-after")) || 10);
    if (!res.ok || !body) throw new WorldError(body?.error ?? "服务器出了点问题，稍后再试试。");
    return body;
  };
  saveProfile = (p: Profile) => this.call<Profile>("saveProfile", p);
  placeRoach = (target: PlaceTarget, at: LngLat) => this.call<OwnRoach[]>("placeRoach", target, at);
  removeRoach = (roachId: string) => this.call<OwnRoach[]>("removeRoach", roachId);
  touch = (publicId: string, bold: boolean) => this.call<TouchResult>("touch", publicId, bold);
  reply = (itemId: string, bold: boolean) => this.call<TouchResult>("reply", itemId, bold);
  inbox = () => this.call<InboxItem[]>("inbox");
  markSeen = (itemIds: string[]) => this.call<void>("markSeen", itemIds);
  declare = (d: Declaration, from?: string[]) => this.call<{ reach: string }>("declare", d, from);
  react = (itemId: string, reaction: Reaction) => this.call<void>("react", itemId, reaction);
  ignore = (itemId: string) => this.call<void>("ignore", itemId);
  friends = () => this.call<Friend[]>("friends");
  unfriend = (friendId: string) => this.call<void>("unfriend", friendId);
  radar = () => this.call<Radar | null>("radar");
  block = (target: string) => this.call<void>("block", target);
  unblock = (blockId: string) => this.call<void>("unblock", blockId);
  blocks = () => this.call<BlockedPlayer[]>("blocks");
  report = (target: string, reason: ReportReason, note: string) => this.call<void>("report", target, reason, note);
  identities = () => this.call<Identity[]>("identities");
  become = (id: PlayerId) => this.call<void>("become", id);
  reset = () => this.call<void>("reset");
}
