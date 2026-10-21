"use client";

import { useState } from "react";
import { GAME_NAMES } from "@/lib/games";
import type { PublicProfile } from "@/lib/profile";
import { roachDataUrl } from "@/lib/roachSvg";
import { DECLARATION_RADIUS_KM, INBOX_DAYS } from "@/lib/rules";
import type { Friend, InboxItem } from "@/lib/world/types";
import Sheet from "./Sheet";

export type InboxTab = "messages" | "friends";

export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

function touchText(item: Extract<InboxItem, { kind: "touch" }>) {
  const who = item.from?.displayName;
  if (item.bold && who) {
    if (item.target === "touch") return `${who} 大胆地碰回来了！`;
    if (item.target === "declaration") return `${who} 回应了你的独立宣言，大胆地碰了碰你！`;
    if (item.target === "clone") return `${who} 大胆地伸出触须，碰了碰你的克隆体`;
    return `${who} 大胆地伸出触须，碰了碰你的蟑螂`;
  }
  if (item.target === "touch") return "有只蟑螂偷偷碰回来了";
  if (item.target === "declaration") return "有只蟑螂回应了你的独立宣言，偷偷碰了你一下";
  if (item.target === "clone") return "一只蟑螂偷偷用触须碰了你的克隆体";
  return "一只蟑螂偷偷用触须碰了你一下";
}

/** Headline for the notice shown when a player opens the map with unseen items. */
export function noticeTitle(items: InboxItem[]) {
  const unseen = items.filter((i) => !i.seen);
  if (unseen.some((i) => i.kind === "friend")) return "你有了新的触须之交！";
  if (unseen.some((i) => i.kind === "touch")) return "你被蟑螂触须碰了一下！";
  if (unseen.length) return "附近有舟p发表了独立宣言！";
  return "消息";
}

export default function InboxSheet({
  items,
  friends,
  tab,
  notice,
  onTab,
  onReply,
  onViewProfile,
  onOpenFriend,
  onClose,
}: {
  items: InboxItem[];
  friends: Friend[];
  tab: InboxTab;
  /** Opened by itself because there was something new */
  notice: boolean;
  onTab: (tab: InboxTab) => void;
  onReply: (itemId: string, bold: boolean) => Promise<void>;
  onViewProfile: (p: PublicProfile) => void;
  onOpenFriend: (friendId: string) => void;
  onClose: () => void;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  const reply = async (id: string, bold: boolean) => {
    await onReply(id, bold);
    setReplying(null);
  };
  const friendIds = new Set(friends.map((f) => f.id));

  const replyButtons = (item: InboxItem, label: string) =>
    item.replied ? (
      <span className="done">已经碰过 TA 了</span>
    ) : replying === item.id ? (
      <>
        <button className="pill" onClick={() => reply(item.id, false)}>
          偷偷碰
        </button>
        <button className="pill dark" onClick={() => reply(item.id, true)}>
          大胆碰
        </button>
        <button className="pill" onClick={() => setReplying(null)}>
          算了
        </button>
      </>
    ) : (
      <button className="pill" onClick={() => setReplying(item.id)}>
        {label}
      </button>
    );

  const message = (item: InboxItem) => {
    const cls = `msg ${item.seen ? "" : "new"}`;
    if (item.kind === "friend") {
      return (
        <div key={item.id} className={cls}>
          <div>你和 {item.from.displayName} 互相大胆碰过，成为了触须之交！</div>
          <div className="meta">{ago(item.at)}</div>
          {friendIds.has(item.friendId) && (
            <div className="row-actions">
              <button className="pill dark" onClick={() => onOpenFriend(item.friendId)}>
                看看 TA
              </button>
            </div>
          )}
        </div>
      );
    }
    if (item.kind === "touch") {
      return (
        <div key={item.id} className={cls}>
          <div>{touchText(item)}</div>
          <div className="meta">{ago(item.at)}</div>
          <div className="row-actions">
            {item.from && (
              <button className="pill" onClick={() => onViewProfile(item.from!)}>
                查看 TA 的资料
              </button>
            )}
            {replyButtons(item, "碰回去")}
          </div>
        </div>
      );
    }
    return (
      <div key={item.id} className={cls}>
        <div>{DECLARATION_RADIUS_KM} 公里内有舟p发表了独立宣言：</div>
        <div className="quote">「{item.text}」</div>
        <div className="meta">{ago(item.at)}</div>
        <div className="row-actions">{replyButtons(item, "碰 TA 一下")}</div>
      </div>
    );
  };

  return (
    <Sheet title={notice ? noticeTitle(items) : tab === "friends" ? "触须之交" : "消息"} onClose={onClose}>
      <div className="seg tabs" role="tablist">
        <button role="tab" aria-selected={tab === "messages"} className={tab === "messages" ? "on" : ""} onClick={() => onTab("messages")}>
          消息
        </button>
        <button role="tab" aria-selected={tab === "friends"} className={tab === "friends" ? "on" : ""} onClick={() => onTab("friends")}>
          触须之交{friends.length > 0 && ` ${friends.length}`}
        </button>
      </div>

      {tab === "messages" && (
        <>
          {items.length === 0 && <p className="hint">还没有消息。点别的蟑螂伸出触须，或者发一条独立宣言试试。</p>}
          {items.map(message)}
        </>
      )}

      {tab === "friends" && (
        <>
          {friends.length === 0 && (
            <p className="hint">还没有触须之交。你大胆碰了 TA，TA 也大胆碰了你，你们就会成为触须之交。</p>
          )}
          {friends.map((f) => (
            <button key={f.id} className="list-row friend-row" onClick={() => onOpenFriend(f.id)}>
              <img src={roachDataUrl(f.profile.color, { friend: true })} width={40} height={40} alt="" />
              <div>
                <strong>{f.profile.displayName}</strong>
                <p className="muted">
                  {ago(f.since)}成为触须之交 · {f.roaches.length} 只蟑螂 · 宣言 {f.declarations} 次
                </p>
              </div>
              <span className="chev">›</span>
            </button>
          ))}
        </>
      )}
    </Sheet>
  );
}

function ProfileDetails({ profile }: { profile: PublicProfile }) {
  if (profile.games.length === 0) return <p className="hint">TA 还没填自己玩什么游戏。</p>;
  return (
    <dl className="pf">
      {profile.games.map((g) => (
        <div key={g}>
          <dt>{GAME_NAMES[g]}</dt>
          <dd>厨力角色：{profile.favourites[g].length ? profile.favourites[g].join("、") : "还没选"}</dd>
          {profile.uid?.[g] && <dd>UID：{profile.uid[g]}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function ProfileView({ profile, onBack, onClose }: { profile: PublicProfile; onBack: () => void; onClose: () => void }) {
  return (
    <Sheet title="TA 的资料" onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <img src={roachDataUrl(profile.color)} width={52} height={52} alt="" />
        <strong>{profile.displayName}</strong>
      </div>
      <ProfileDetails profile={profile} />
      <p className="hint" style={{ marginTop: 16 }}>
        TA 大胆伸出触须，所以你能看到这些。TA 的位置不会给任何人看。
      </p>
    </Sheet>
  );
}

function eventText(e: Friend["history"][number]) {
  switch (e.kind) {
    case "touched":
      if (e.you) return e.bold ? "大胆地碰了你" : "偷偷碰了你";
      return e.bold ? "大胆地碰了一只蟑螂" : "偷偷碰了一只蟑螂";
    case "touchedBy":
      if (e.you) return e.bold ? "被你大胆地碰了" : "被你偷偷碰了";
      return e.bold ? "被一只蟑螂大胆地碰了" : "被一只蟑螂偷偷碰了";
    case "declared":
      return `发表了独立宣言「${e.text}」`;
    case "befriended":
      return e.you ? "和你成为了触须之交" : "和一位舟p成为了触须之交";
  }
}

export function FriendView({
  friend,
  onFind,
  onUnfriend,
  onBack,
  onClose,
}: {
  friend: Friend;
  onFind: (roachIndex: number) => void;
  onUnfriend: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { profile } = friend;
  return (
    <Sheet title="触须之交" onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <img src={roachDataUrl(profile.color, { friend: true })} width={52} height={52} alt="" />
        <div>
          <strong>{profile.displayName}</strong>
          <p className="hint">{ago(friend.since)}成为触须之交</p>
        </div>
      </div>
      <ProfileDetails profile={profile} />

      <h3>TA 的蟑螂</h3>
      {friend.roaches.length === 0 && <p className="hint">TA 现在没有放蟑螂。</p>}
      {friend.roaches.map((r, i) => (
        <div className="list-row" key={r.id}>
          <img src={roachDataUrl(r.color, { friend: true, clone: r.clone })} width={36} height={36} alt="" />
          <div>
            <strong>{r.clone ? `克隆体 ${i}` : "本体"}</strong>
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onFind(i)}>
              找到
            </button>
          </div>
        </div>
      ))}
      <p className="hint">位置和别人看到的一样，是约 1 公里外的大概位置。</p>

      <h3>最近 {INBOX_DAYS} 天发表了 {friend.declarations} 次独立宣言</h3>

      <h3>社交记录</h3>
      {friend.history.length === 0 && <p className="hint">最近还没有动静。</p>}
      {friend.history.map((e, i) => (
        <div className="event" key={i}>
          <span>{eventText(e)}</span>
          <span className="muted">{ago(e.at)}</span>
        </div>
      ))}

      <button className="danger wide" style={{ marginTop: 20 }} onClick={onUnfriend}>
        解除触须之交
      </button>
      <p className="hint">解除后你们互相看不到对方的蟑螂和记录了；想再成为触须之交，要重新互相大胆碰一次。</p>
    </Sheet>
  );
}
