"use client";

import { useState } from "react";
import { REACTIONS, type Reaction } from "@/lib/declarations";
import { GAME_NAMES } from "@/lib/games";
import type { PublicProfile } from "@/lib/profile";
import { DECLARATION_RADIUS_KM, INBOX_DAYS } from "@/lib/rules";
import type { Friend, InboxItem } from "@/lib/world/types";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

export type InboxTab = "replies" | "touches" | "friends";

const TABS: { tab: InboxTab; label: string }[] = [
  { tab: "replies", label: "收到的回复" },
  { tab: "touches", label: "收到的触碰" },
  { tab: "friends", label: "触须之交" },
];

/** Declarations and reactions are replies; touches and new friends have their own tabs. */
export function tabOf(item: InboxItem): InboxTab {
  if (item.kind === "touch") return "touches";
  if (item.kind === "friend") return "friends";
  return "replies";
}

/** Open on the tab the notice headline talks about (see noticeTitle). */
export function firstTab(items: InboxItem[]): InboxTab {
  const unseen = items.filter((i) => !i.seen);
  if (unseen.some((i) => i.kind === "friend")) return "friends";
  if (unseen.some((i) => i.kind === "touch")) return "touches";
  return "replies";
}

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
    if (item.target === "reaction") return `${who} 看到了你的回应，大胆地碰了碰你！`;
    if (item.target === "clone") return `${who} 大胆地伸出触须，碰了碰你的克隆体`;
    return `${who} 大胆地伸出触须，碰了碰你的蟑螂`;
  }
  if (item.target === "touch") return "有只蟑螂偷偷碰回来了";
  if (item.target === "declaration") return "有只蟑螂回应了你的独立宣言，偷偷碰了你一下";
  if (item.target === "reaction") return "有只蟑螂看到了你的回应，偷偷碰了你一下";
  if (item.target === "clone") return "一只蟑螂偷偷用触须碰了你的克隆体";
  return "一只蟑螂偷偷用触须碰了你一下";
}

/** Headline for the notice shown when a player opens the map with unseen items. */
export function noticeTitle(items: InboxItem[]) {
  const unseen = items.filter((i) => !i.seen);
  if (unseen.some((i) => i.kind === "friend")) return "你有了新的触须之交！";
  if (unseen.some((i) => i.kind === "touch")) return "你被蟑螂触须碰了一下！";
  if (unseen.some((i) => i.kind === "reaction")) return "有舟p回应了你的独立宣言！";
  if (unseen.length) return "附近有舟p发表了独立宣言！";
  return "消息";
}

export default function InboxSheet({
  items,
  friends,
  tab,
  viewed,
  notice,
  onTab,
  onReply,
  onReact,
  onIgnore,
  onViewProfile,
  onOpenFriend,
  onSafety,
  onClose,
}: {
  items: InboxItem[];
  friends: Friend[];
  tab: InboxTab;
  /** Tabs opened since the inbox was; their messages count as read */
  viewed: InboxTab[];
  /** Opened by itself because there was something new */
  notice: boolean;
  onTab: (tab: InboxTab) => void;
  onReply: (itemId: string, bold: boolean) => Promise<void>;
  onReact: (itemId: string, reaction: Reaction) => Promise<void>;
  onIgnore: (itemId: string) => Promise<void>;
  onViewProfile: (p: PublicProfile) => void;
  onOpenFriend: (friendId: string) => void;
  /** 拉黑或举报 the sender: an inbox item id, or "friend:<id>" */
  onSafety: (target: string, who: string | null) => void;
  onClose: () => void;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  const reply = async (id: string, bold: boolean) => {
    await onReply(id, bold);
    setReplying(null);
  };
  const [reacting, setReacting] = useState<string | null>(null);
  const react = async (id: string, reaction: Reaction) => {
    setReacting(id);
    await onReact(id, reaction);
    setReacting(null);
  };
  const friendIds = new Set(friends.map((f) => f.id));
  const shown = items.filter((i) => tabOf(i) === tab);
  // items keep their unread look while the inbox is open, but a tab's red count goes once you have looked at it
  const unseenIn = (t: InboxTab) => (viewed.includes(t) ? 0 : items.filter((i) => !i.seen && tabOf(i) === t).length);

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

  const meta = (item: InboxItem, target: string, who: string | null) => (
    <div className="meta">
      {ago(item.at)}
      <button className="link" onClick={() => onSafety(target, who)}>
        拉黑/举报
      </button>
    </div>
  );

  const message = (item: InboxItem) => {
    const cls = `msg ${item.seen ? "" : "new"}`;
    if (item.kind === "friend") {
      return (
        <div key={item.id} className={cls}>
          <div>你和 {item.from.displayName} 互相大胆碰过，成为了触须之交！</div>
          {meta(item, `friend:${item.friendId}`, item.from.displayName)}
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
          {meta(item, item.id, item.from?.displayName ?? null)}
          <div className="row-actions">
            {item.from && (
              <button className="pill" onClick={() => onViewProfile(item.from!)}>
                查看 TA 的资料
              </button>
            )}
            {item.ignored ? (
              <span className="done">你默默爬走了</span>
            ) : (
              <>
                {replyButtons(item, "碰回去")}
                {!item.replied && replying !== item.id && (
                  <button className="pill" onClick={() => onIgnore(item.id)}>
                    默默爬走（不予理会）
                  </button>
                )}
              </>
            )}
          </div>
          {replying === item.id && (item.target === "main" || item.target === "clone") && (
            <p className="hint">大胆碰回去，TA 就会知道刚才碰的那只蟑螂是你的。</p>
          )}
        </div>
      );
    }
    if (item.kind === "reaction") {
      return (
        <div key={item.id} className={cls}>
          <div>附近有舟p回应了你的宣言「{item.text}」：</div>
          <div className="quote">{REACTIONS[item.reaction]}</div>
          {meta(item, item.id, null)}
          <div className="row-actions">{replyButtons(item, "碰 TA 一下")}</div>
        </div>
      );
    }
    return (
      <div key={item.id} className={cls}>
        <div>{DECLARATION_RADIUS_KM} 公里内有舟p发表了独立宣言：</div>
        <div className="quote">「{item.text}」</div>
        {meta(item, item.id, null)}
        {item.reaction ? (
          <div className="done">你回应了：{REACTIONS[item.reaction]}</div>
        ) : (
          <div className="chips reactions">
            {item.options.map((r) => (
              <button key={r} className="chip" disabled={reacting === item.id} onClick={() => react(item.id, r)}>
                {REACTIONS[r]}
              </button>
            ))}
          </div>
        )}
        <div className="row-actions">{replyButtons(item, "碰 TA 一下")}</div>
      </div>
    );
  };

  return (
    <Sheet title={notice ? noticeTitle(items) : "消息"} onClose={onClose}>
      <div className="seg tabs" role="tablist">
        {TABS.map(({ tab: t, label }) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
            {label}
            {unseenIn(t) > 0 && <span className="badge">{unseenIn(t)}</span>}
          </button>
        ))}
      </div>

      {tab === "replies" && shown.length === 0 && (
        <p className="hint">还没有回复。附近的舟p发宣言、或者回应你的宣言，都会出现在这里。</p>
      )}
      {tab === "touches" && shown.length === 0 && <p className="hint">还没有被碰过。点别的蟑螂伸出触须试试。</p>}
      {shown.map(message)}

      {tab === "friends" && (
        <>
          {friends.length === 0 && (
            <p className="hint">还没有触须之交。你大胆碰了 TA，TA 也大胆碰了你，你们就会成为触须之交。</p>
          )}
          {friends.map((f) => (
            <button key={f.id} className="list-row friend-row" onClick={() => onOpenFriend(f.id)}>
              <RoachIcon color={f.profile.color} size={40} avatar={f.profile.avatar} friend />
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
        <RoachIcon color={profile.color} size={52} avatar={profile.avatar} />
        <strong>{profile.displayName}</strong>
      </div>
      <ProfileDetails profile={profile} />
      <p className="hint" style={{ marginTop: 16 }}>
        TA 大胆伸出触须，所以你能看到这些。
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
  onSafety,
  onBack,
  onClose,
}: {
  friend: Friend;
  onFind: (roachIndex: number) => void;
  onUnfriend: () => void;
  onSafety: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { profile } = friend;
  return (
    <Sheet title="触须之交" onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <RoachIcon color={profile.color} size={52} avatar={profile.avatar} friend />
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
          <RoachIcon color={r.color} size={36} avatar={r.avatar} friend clone={r.clone} />
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
      <button className="pill" style={{ marginTop: 14 }} onClick={onSafety}>
        拉黑或举报 TA
      </button>
    </Sheet>
  );
}
