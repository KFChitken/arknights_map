import type { Declaration, Reaction } from "../declarations";
import type { Profile } from "../profile";
import type { LngLat } from "../types";
import {
  SignInNeeded,
  WorldError,
  type Friend,
  type Identity,
  type InboxItem,
  type Me,
  type OwnRoach,
  type PlaceTarget,
  type PlayerId,
  type PublicRoach,
  type Radar,
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
  roaches = () => this.call<PublicRoach[]>("roaches");
  saveProfile = (p: Profile) => this.call<Profile>("saveProfile", p);
  placeRoach = (target: PlaceTarget, at: LngLat) => this.call<OwnRoach[]>("placeRoach", target, at);
  removeRoach = (roachId: string) => this.call<OwnRoach[]>("removeRoach", roachId);
  touch = (publicId: string, bold: boolean) => this.call<TouchResult>("touch", publicId, bold);
  reply = (itemId: string, bold: boolean) => this.call<TouchResult>("reply", itemId, bold);
  inbox = () => this.call<InboxItem[]>("inbox");
  markSeen = (itemIds: string[]) => this.call<void>("markSeen", itemIds);
  declare = (d: Declaration, from?: string[]) => this.call<{ reach: string }>("declare", d, from);
  react = (itemId: string, reaction: Reaction) => this.call<void>("react", itemId, reaction);
  friends = () => this.call<Friend[]>("friends");
  unfriend = (friendId: string) => this.call<void>("unfriend", friendId);
  radar = () => this.call<Radar | null>("radar");
  identities = () => this.call<Identity[]>("identities");
  become = (id: PlayerId) => this.call<void>("become", id);
  reset = () => this.call<void>("reset");
}
