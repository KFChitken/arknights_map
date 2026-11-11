"use client";

import { useState, type ReactNode } from "react";
import { AMIYA_ID, AMIYA_NAME, amiyaLine } from "@/lib/amiya";
import { beijingDayWords } from "@/lib/beijing";
import type { Reply } from "@/lib/declarations";
import {
  anniversaryText,
  GESTURE_BACK,
  FRIEND_ACTS_PER_DAY,
  GESTURE_RETURNED,
  gestureText,
  isAwakeGesture,
  sanityText,
  sanityThanks,
  type AwakeGesture,
} from "@/lib/friendly";
import { GAME_NAMES, serverName, type Game } from "@/lib/games";
import { guideById, isGuideItem } from "@/lib/guides";
import { PERLICA_ID, PERLICA_UNFRIEND, perlicaText } from "@/lib/perlica";
import { MINGHE_ID, mingheText, tripStops } from "@/lib/minghe";
import { talulahText } from "@/lib/talulah";
import type { PublicProfile } from "@/lib/profile";
import { DECLARATION_RADIUS_KM, INBOX_DAYS } from "@/lib/rules";
import { APPEAL_MAX, APPEAL_MIN } from "@/lib/safety";
import type { LngLat } from "@/lib/types";
import { boldOnly, type Friend, type InboxItem, type StaffAppeal } from "@/lib/world/types";
import { BadgePill, TheirBadges } from "./Badges";
import OperatorNames from "./OperatorNames";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

export type InboxTab = "replies" | "touches" | "friends";

/** What can be touched back from 消息: a touch, a declaration, or a reaction to yours */
type Answerable = Extract<InboxItem, { kind: "touch" | "declaration" | "reaction" }>;

/** What ending it with 阿米娅向导 means; also the question before it */
export const AMIYA_UNFRIEND = "解除后阿米娅不会再每天跟你打招呼，她还在罗德岛等你。";

const TABS: { tab: InboxTab; label: string }[] = [
  { tab: "replies", label: "收到的回复" },
  { tab: "touches", label: "收到的触碰" },
  { tab: "friends", label: "触须之交" },
];

/** What happens between 触须之交: new friends, 戳一戳 both ways, and all they do for each other (src/lib/friendly.ts) */
const BETWEEN_FRIENDS: InboxItem["kind"][] = ["friend", "poke", "pokeWoke", "sanity", "sanityThanks", "gesture", "visit", "game", "anniversary"];

/** Touches, the guides' included */
const TOUCHES: InboxItem["kind"][] = ["touch", "amiya", "perlica", "talulah", "minghe"];

/** Declarations and reactions are replies; touches (the guides' too) and what happens between 触须之交 have their own tabs. */
export function tabOf(item: InboxItem): InboxTab {
  if (TOUCHES.includes(item.kind)) return "touches";
  if (BETWEEN_FRIENDS.includes(item.kind)) return "friends";
  return "replies";
}

/** Open on the tab the notice headline talks about (see noticeTitle). */
export function firstTab(items: InboxItem[]): InboxTab {
  const unseen = items.filter((i) => !i.seen);
  if (unseen.some((i) => BETWEEN_FRIENDS.includes(i.kind))) return "friends";
  if (unseen.some((i) => TOUCHES.includes(i.kind))) return "touches";
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

/** Who poked you while you slept, among the pokes you have not seen: 「A」, 「A 和 B」 or 「A、B 等 N 位触须之交」; "" for nobody. */
export function pokedBy(items: InboxItem[]) {
  const names = [...new Set(items.flatMap((i) => (i.kind === "poke" && !i.seen ? [i.from.displayName] : [])))];
  if (names.length <= 2) return names.join(" 和 ");
  return `${names.slice(0, 2).join("、")} 等 ${names.length} 位触须之交`;
}

/** Headline for the notice shown when a player opens the map with unseen items. */
export function noticeTitle(items: InboxItem[]) {
  const unseen = items.filter((i) => !i.seen);
  if (unseen.some((i) => i.kind === "staff")) return "站长给你发了通知";
  if (unseen.some((i) => i.kind === "friend")) return "你有了新的触须之交！";
  if (unseen.some((i) => i.kind === "poke")) return "有触须之交趁你睡着戳了戳你！";
  if (unseen.some((i) => i.kind === "pokeWoke")) return "你戳过的触须之交醒啦！";
  if (unseen.some((i) => i.kind === "anniversary")) return "今天是触须之交纪念日！";
  if (unseen.some((i) => i.kind === "visit" && i.event === "came")) return "有触须之交来你家串门了！";
  if (unseen.some((i) => i.kind === "visit")) return "你的克隆体有新消息！";
  if (unseen.some((i) => i.kind === "sanity")) return "触须之交催你清理智啦！";
  if (unseen.some((i) => i.kind === "gesture")) return "触须之交和你互动了！";
  if (unseen.some((i) => i.kind === "sanityThanks" || i.kind === "game")) return "触须之交回你了！";
  if (unseen.some((i) => i.kind === "touch")) return "你被蟑螂触须碰了一下！";
  if (unseen.some((i) => i.kind === "amiya")) return "阿米娅向导碰了碰你！";
  if (unseen.some((i) => i.kind === "perlica")) return "佩丽卡监督碰了碰你！";
  if (unseen.some((i) => i.kind === "talulah")) return "塔露拉干员回了你！";
  if (unseen.some((i) => i.kind === "minghe" && i.line === "trip")) return "明河都尉送你的克隆体回来了！";
  if (unseen.some((i) => i.kind === "minghe")) return "明河都尉回了你！";
  if (unseen.some((i) => i.kind === "reaction")) return "有舟P回应了你的独立宣言！";
  if (unseen.length) return "附近有舟P发表了独立宣言！";
  return "消息";
}

/** What happened with a visiting clone (串门), by who did it */
function visitText(item: Extract<InboxItem, { kind: "visit" }>) {
  const who = item.from.displayName;
  switch (item.event) {
    case "came":
      return `${who} 的克隆体来你家串门了`;
    case "sentHome":
      return `${who} 请你的克隆体先回家休息啦`;
    case "hostMoved":
      return `${who} 搬家了，你的克隆体还在老地方`;
    case "hostRemoved":
      return `${who} 收回了那只蟑螂，你的克隆体还在老地方`;
    case "closed":
      return `${who} 现在不接待客人，你的克隆体先回家了`;
  }
}

/** 游戏里也加个好友, by who */
function gameText(item: Extract<InboxItem, { kind: "game" }>) {
  const who = item.from.displayName;
  const game = GAME_NAMES[item.game];
  if (item.event === "added") return `${who}：${game}里也加上了！`;
  if (item.event === "want") return `${who} 想在游戏里加你。愿意的话，在「我的资料」里填 UID 并打开分享。`;
  return `${who} 说已经在${game}${item.server ? `（${item.server}）` : ""}向你发了好友申请，去游戏里通过一下吧。`;
}

/** What you can do from a 触须之交's message (src/lib/friendly.ts) */
export type InboxFriendly = {
  answerSanity: (itemId: string, answer: "done" | "ok") => Promise<void>;
  /** 贴回去, 击回去, 吸回来 */
  gestureBack: (friendId: string, gesture: AwakeGesture, itemId: string) => Promise<void>;
  /** 去看看: to a guest sitting by your roach */
  look: (spot: LngLat) => void;
  sendHome: (friendId: string) => Promise<void>;
  follow: (cloneId: string) => Promise<void>;
  goHome: (cloneId: string) => Promise<void>;
  gameAdded: (itemId: string) => Promise<void>;
};

/**
 * 我觉得处理错了, under a 站长通知 about something the admin did: a box for why, sent once; then that it
 * was, until the admin's answer comes as a note of its own.
 */
function AppealRow({ appeal, onAppeal }: { appeal: StaffAppeal; onAppeal: (actionId: string, text: string) => Promise<boolean> }) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (appeal.state === "sent") return <p className="hint appeal-done">已经申诉了，站长会再看一次。</p>;
  if (appeal.state === "answered") return null;
  if (!writing) {
    return (
      <div className="row-actions">
        <button className="pill" onClick={() => setWriting(true)}>
          我觉得处理错了
        </button>
      </div>
    );
  }
  const length = [...text.trim()].length;
  const send = async () => {
    setBusy(true);
    const sent = await onAppeal(appeal.actionId, text);
    setBusy(false);
    if (sent) setWriting(false);
  };
  return (
    <div className="appeal-box">
      <textarea
        value={text}
        maxLength={APPEAL_MAX}
        rows={3}
        placeholder={`说说为什么觉得处理错了（${APPEAL_MIN} 到 ${APPEAL_MAX} 个字）`}
        aria-label="申诉理由"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button className="pill dark" disabled={busy || length < APPEAL_MIN} onClick={send}>
          提交申诉
        </button>
        <button className="pill" disabled={busy} onClick={() => setWriting(false)}>
          算了
        </button>
      </div>
      <p className="hint">只能申诉一次，站长看了会在这里告诉你结果。</p>
    </div>
  );
}

/** What one of 阿米娅向导's touches says, in her own words. */
function amiyaText(item: Extract<InboxItem, { kind: "amiya" }>, games: Game[]) {
  if (item.greet) return `${AMIYA_NAME}碰了碰你：「${amiyaLine("greet", games)}」`;
  return item.bold
    ? `${AMIYA_NAME}大胆地碰回来了：「${amiyaLine("bold", games)}」`
    : `${AMIYA_NAME}偷偷碰回来了：「${amiyaLine("sneaky", games)}」`;
}

export default function InboxSheet({
  items,
  friends,
  games,
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
  onAppeal,
  friendly,
  suspendedUntil = null,
  onClose,
}: {
  items: InboxItem[];
  friends: Friend[];
  /** Your games, for whether 阿米娅向导 calls you 博士 or 管理员 */
  games: Game[];
  tab: InboxTab;
  /** Tabs opened since the inbox was; their messages count as read */
  viewed: InboxTab[];
  /** Opened by itself because there was something new */
  notice: boolean;
  onTab: (tab: InboxTab) => void;
  onReply: (itemId: string, bold: boolean) => Promise<void>;
  onReact: (itemId: string, reaction: string) => Promise<void>;
  onIgnore: (itemId: string) => Promise<void>;
  /** target: the message the profile came with, for blocking or reporting its sender */
  onViewProfile: (p: PublicProfile, target: string) => void;
  onOpenFriend: (friendId: string) => void;
  /** 拉黑或举报 the sender: an inbox item id, or "friend:<id>" */
  onSafety: (target: string, who: string | null) => void;
  /** 我觉得处理错了 on a 站长通知: whether it went */
  onAppeal: (itemId: string, actionId: string, text: string) => Promise<boolean>;
  friendly: InboxFriendly;
  /** 暂停互动 until then, said at the top */
  suspendedUntil?: number | null;
  onClose: () => void;
}) {
  const [replying, setReplying] = useState<string | null>(null);
  // one 触须之交 message at a time is being acted on
  const [acting, setActing] = useState<string | null>(null);
  const act = async (id: string, go: () => Promise<void>) => {
    setActing(id);
    try {
      await go();
    } finally {
      setActing(null);
    }
  };
  const reply = async (id: string, bold: boolean) => {
    await onReply(id, bold);
    setReplying(null);
  };
  const [reacting, setReacting] = useState<string | null>(null);
  const react = async (id: string, reaction: string) => {
    setReacting(id);
    await onReact(id, reaction);
    setReacting(null);
  };
  const friendIds = new Set(friends.map((f) => f.id));
  const betweenOf = (friendId: string) => friends.find((f) => f.id === friendId)?.between;
  const shown = items.filter((i) => tabOf(i) === tab);
  // items keep their unread look while the inbox is open, but a tab's red count goes once you have looked at it
  const unseenIn = (t: InboxTab) => (viewed.includes(t) ? 0 : items.filter((i) => !i.seen && tabOf(i) === t).length);

  const replyButtons = (item: Answerable, label: string) =>
    item.replied ? (
      <span className="done">已经碰过 TA 了</span>
    ) : item.waits === "all" ? (
      // you touched TA in the last day: touching back waits, so touches never go back and forth
      <span className="done">今天碰过 TA 了，明天再碰回去吧</span>
    ) : replying === item.id ? (
      <>
        {!boldOnly(item.waits) && (
          <button className="pill" onClick={() => reply(item.id, false)}>
            偷偷碰
          </button>
        )}
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
  /**
   * Under the buttons while answering: why only 「大胆碰」 is there, or what a bold touch back tells TA. That it
   * makes you 触须之交 is said on touches only, as before: under a declaration or a reaction it would say
   * more about who sent it.
   */
  const replyNote = (item: Answerable) => {
    if (replying !== item.id) return null;
    // TA touched one of your roaches on the map
    const yours = item.kind === "touch" && (item.target === "main" || item.target === "clone");
    const text =
      item.waits === "reveal"
        ? `今天你偷偷碰过 TA 了，再偷偷碰要等明天；大胆碰回去，TA 就知道是你${yours ? "，也知道刚才碰的那只蟑螂是你的" : ""}。`
        : item.kind !== "touch"
          ? null
          : item.waits === "sneaky"
            ? "今天你碰过 TA 了，偷偷碰回去要等明天；大胆碰回去，你们就结成触须之交。"
            : yours
              ? "大胆碰回去，TA 就会知道刚才碰的那只蟑螂是你的。"
              : null;
    return text && <p className="hint">{text}</p>;
  };

  const meta = (item: InboxItem, target: string, who: string | null) => (
    <div className="meta">
      {ago(item.at)}
      {/* a guide is nobody, so there is nobody to block */}
      {!isGuideItem(item.id) && (
        <button className="link" onClick={() => onSafety(target, who)}>
          拉黑/举报
        </button>
      )}
    </div>
  );

  const message = (item: InboxItem) => {
    const cls = `msg ${item.seen ? "" : "new"}`;
    // 站长: no picture, nobody to touch back or block
    if (item.kind === "staff") {
      return (
        <div key={item.id} className={`${cls} staff`}>
          <div className="staff-from">站长</div>
          <div>{item.text}</div>
          {item.appeal && <AppealRow appeal={item.appeal} onAppeal={(actionId, text) => onAppeal(item.id, actionId, text)} />}
          <div className="meta">{ago(item.at)}</div>
        </div>
      );
    }
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
    if (item.kind === "poke" || item.kind === "pokeWoke") {
      const who = item.from.displayName;
      return (
        <div key={item.id} className={cls}>
          <div>{item.kind === "poke" ? `${who} 趁你睡着戳了戳你！` : `你戳过的 ${who} 醒啦！`}</div>
          {meta(item, item.kind === "poke" ? item.id : `friend:${item.friendId}`, who)}
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
    if (
      item.kind === "sanity" ||
      item.kind === "sanityThanks" ||
      item.kind === "gesture" ||
      item.kind === "visit" ||
      item.kind === "game" ||
      item.kind === "anniversary"
    ) {
      const who = item.from.displayName;
      const busy = acting === item.id;
      const friend = friendIds.has(item.friendId);
      let text: string;
      let actions: ReactNode = null;
      let note: ReactNode = null;
      if (item.kind === "sanity") {
        text = sanityText(who, item.asleep);
        actions =
          item.answer === "done" ? (
            <span className="done">已告诉 TA：清完了</span>
          ) : item.answer === "ok" ? (
            <span className="done">知道啦</span>
          ) : (
            <>
              <button className="pill dark" disabled={busy} onClick={() => act(item.id, () => friendly.answerSanity(item.id, "done"))}>
                清完了！
              </button>
              <button className="pill" disabled={busy} onClick={() => act(item.id, () => friendly.answerSanity(item.id, "ok"))}>
                知道啦
              </button>
            </>
          );
      } else if (item.kind === "sanityThanks") {
        text = sanityThanks(who);
      } else if (item.kind === "gesture") {
        text = gestureText(item.gesture, who);
        const g = item.gesture;
        if (isAwakeGesture(g) && friend) {
          // the day's FRIEND_ACTS_PER_DAY for TA used up: answering waits till tomorrow
          const full = betweenOf(item.friendId)?.actsLeft === 0;
          actions = item.returned ? (
            <span className="done">{GESTURE_RETURNED[g]}</span>
          ) : (
            <button
              className="pill dark"
              disabled={busy || full || betweenOf(item.friendId)?.asleep}
              onClick={() => act(item.id, () => friendly.gestureBack(item.friendId, g, item.id))}
            >
              {full ? `今天满 ${FRIEND_ACTS_PER_DAY} 次了` : GESTURE_BACK[g]}
            </button>
          );
        }
      } else if (item.kind === "visit") {
        text = visitText(item);
        if (item.tip) note = <p className="hint">提醒一下：别把本体放在家门口。</p>;
        if (item.event === "came" && item.spot) {
          const spot = item.spot;
          actions = (
            <>
              <button className="pill dark" onClick={() => friendly.look(spot)}>
                去看看
              </button>
              {friend && (
                <button className="pill" disabled={busy} onClick={() => act(item.id, () => friendly.sendHome(item.friendId))}>
                  请 TA 回家
                </button>
              )}
            </>
          );
        } else if (item.cloneId) {
          const clone = item.cloneId;
          actions = (
            <>
              {item.event === "hostMoved" && friend && (
                <button className="pill dark" disabled={busy} onClick={() => act(item.id, () => friendly.follow(clone))}>
                  跟过去
                </button>
              )}
              <button className="pill" disabled={busy} onClick={() => act(item.id, () => friendly.goHome(clone))}>
                回家
              </button>
            </>
          );
          if (item.event === "hostMoved") note = <p className="hint">跟过去算一次挪窝，回家不算。</p>;
        }
      } else if (item.kind === "game") {
        text = gameText(item);
        if (item.event === "ask") {
          actions = item.answered ? (
            <span className="done">已告诉 TA：我也加了</span>
          ) : friend ? (
            <button className="pill dark" disabled={busy} onClick={() => act(item.id, () => friendly.gameAdded(item.id))}>
              我也加了
            </button>
          ) : null;
        }
      } else {
        text = anniversaryText(item.day, who);
      }
      return (
        <div key={item.id} className={`${cls}${item.kind === "anniversary" ? " anniversary" : ""}`}>
          <div>{text}</div>
          {note}
          {meta(item, `friend:${item.friendId}`, who)}
          <div className="row-actions">
            {actions}
            {friend && (
              <button className="pill" onClick={() => onOpenFriend(item.friendId)}>
                看看 TA
              </button>
            )}
          </div>
        </div>
      );
    }
    if (item.kind === "amiya" || item.kind === "perlica" || item.kind === "talulah" || item.kind === "minghe") {
      const text =
        item.kind === "amiya"
          ? amiyaText(item, games)
          : item.kind === "perlica"
            ? perlicaText(item)
            : item.kind === "talulah"
              ? talulahText(item, games)
              : mingheText(item);
      return (
        <div key={item.id} className={cls}>
          <div>{text}</div>
          {/* the stations the clone rode through */}
          {item.kind === "minghe" && item.line === "trip" && item.stop !== null && (
            <p className="minghe-trip">{tripStops(item.stop).join("、")}</p>
          )}
          {meta(item, item.id, null)}
          <div className="row-actions">
            {item.ignored ? (
              <span className="done">你默默爬走了</span>
            ) : item.replied ? (
              <span className="done">已经碰过{item.kind === "minghe" ? "他" : "她"}了</span>
            ) : (
              <>
                <button className="pill" disabled={replying === item.id} onClick={() => {
                  setReplying(item.id);
                  reply(item.id, false);
                }}>
                  偷偷碰回去
                </button>
                <button className="pill dark" disabled={replying === item.id} onClick={() => {
                  setReplying(item.id);
                  reply(item.id, true);
                }}>
                  大胆碰回去
                </button>
                <button className="pill" onClick={() => onIgnore(item.id)}>
                  默默爬走
                </button>
              </>
            )}
          </div>
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
              <button className="pill" onClick={() => onViewProfile(item.from!, item.id)}>
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
          {replyNote(item)}
        </div>
      );
    }
    if (item.kind === "reaction") {
      // a 触须之交 answering your birthday, which reached them as theirs: by name
      if (item.from) {
        const who = item.from.displayName;
        return (
          <div key={item.id} className={cls}>
            <div>{item.reaction.id === "birthday" ? `${who} 祝你生日快乐！` : `${who} 回应了你的生日宣言：「${item.reaction.text}」`}</div>
            {meta(item, item.id, who)}
            <div className="row-actions">{replyButtons(item, "碰 TA 一下")}</div>
            {replyNote(item)}
          </div>
        );
      }
      return (
        <div key={item.id} className={cls}>
          <div>附近有舟P回应了你的宣言「{item.text}」：</div>
          <div className="quote">{item.reaction.text}</div>
          {meta(item, item.id, null)}
          <div className="row-actions">{replyButtons(item, "碰 TA 一下")}</div>
          {replyNote(item)}
        </div>
      );
    }
    return (
      <div key={item.id} className={cls}>
        <div>
          {item.from ? `你的触须之交 ${item.from.displayName} 发表了独立宣言：` : `${DECLARATION_RADIUS_KM} 公里内有舟P发表了独立宣言：`}
        </div>
        <div className="quote">「{item.text}」</div>
        {meta(item, item.id, item.from?.displayName ?? null)}
        {item.reaction ? (
          <div className="done">你回应了：{item.reaction.text}</div>
        ) : (
          <>
            {/* this sentence's own four first, then the five every declaration has, on a line of their own */}
            {[item.options.filter((r) => r.own), item.options.filter((r) => !r.own)].map(
              (row: Reply[], i) =>
                row.length > 0 && (
                  <div key={i} className={`chips reactions${i ? " generic" : ""}`}>
                    {row.map((r) => (
                      <button key={r.id} className="chip" disabled={reacting === item.id} onClick={() => react(item.id, r.id)}>
                        {r.text}
                      </button>
                    ))}
                  </div>
                ),
            )}
          </>
        )}
        {item.from && !item.reaction && <p className="hint">TA 能看到是你。</p>}
        <div className="row-actions">{replyButtons(item, "碰 TA 一下")}</div>
        {replyNote(item)}
      </div>
    );
  };

  return (
    <Sheet title={notice ? noticeTitle(items) : "消息"} onClose={onClose}>
      {suspendedUntil && <p className="suspended-banner">你的互动暂停到 {beijingDayWords(suspendedUntil)}。</p>}
      <div className="seg tabs" role="tablist">
        {TABS.map(({ tab: t, label }) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
            {label}
            {unseenIn(t) > 0 && <span className="badge">{unseenIn(t)}</span>}
          </button>
        ))}
      </div>

      {tab === "replies" && shown.length === 0 && (
        <p className="hint">还没有回复。附近的舟P发宣言、或者回应你的宣言，都会出现在这里。</p>
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
                  {guideById(f.id)
                    ? `${ago(f.since)}成为触须之交 · ${guideById(f.id)!.note}`
                    : `${ago(f.since)}成为触须之交 · ${f.roaches.length} 只蟑螂 · 宣言 ${f.declarations} 次`}
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

/** The pill of the badge someone wears, under their name. */
function WornPill({ profile }: { profile: PublicProfile }) {
  const worn = profile.badges?.find((b) => b.id === profile.worn);
  return worn ? (
    <div>
      <BadgePill badge={worn} />
    </div>
  ) : null;
}

/** gameExtra: more under each game, on a 触须之交's page (游戏里也加个好友) */
function ProfileDetails({ profile, gameExtra }: { profile: PublicProfile; gameExtra?: (game: Game) => ReactNode }) {
  const badges = <TheirBadges badges={profile.badges ?? []} worn={profile.worn} />;
  if (profile.games.length === 0) {
    return (
      <>
        {badges}
        <p className="hint">TA 还没填自己玩什么游戏。</p>
      </>
    );
  }
  return (
    <>
      {badges}
      <dl className="pf">
      {profile.games.map((g) => (
        <div key={g}>
          <dt>{GAME_NAMES[g]}</dt>
          <dd>
            厨力角色：{profile.favourites[g].length ? <OperatorNames game={g} names={profile.favourites[g]} /> : "还没选"}
          </dd>
          {g === "arknights" && profile.support && (
            <dd>
              助战：
              <OperatorNames game="arknights" names={profile.support} />
            </dd>
          )}
          {profile.uid?.[g] && (
            <dd>
              UID：{serverName(g, profile.uidServer?.[g]) ? `${serverName(g, profile.uidServer?.[g])} ` : ""}
              <span className="uid">{profile.uid[g]}</span>
            </dd>
          )}
          {gameExtra?.(g)}
        </div>
      ))}
      </dl>
    </>
  );
}

export function ProfileView({
  profile,
  onSafety,
  onBack,
  onClose,
}: {
  profile: PublicProfile;
  onSafety: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="TA 的资料" onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <RoachIcon color={profile.color} size={52} avatar={profile.avatar} />
        <div>
          <strong>{profile.displayName}</strong>
          <WornPill profile={profile} />
        </div>
      </div>
      <ProfileDetails profile={profile} />
      <p className="hint" style={{ marginTop: 16 }}>
        TA 大胆伸出触须，所以你能看到这些。
      </p>
      <button className="pill" style={{ marginTop: 14 }} onClick={onSafety}>
        拉黑或举报 TA
      </button>
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
      return e.you ? "和你成为了触须之交" : "和一位舟P成为了触须之交";
    case "support":
      return "换了助战";
  }
}

export function FriendView({
  friend,
  actions,
  help,
  onStar,
  gameExtra,
  onFind,
  onUnfriend,
  onSafety,
  onBack,
  onClose,
}: {
  friend: Friend;
  /** 触须之交专属: the row of what only 触须之交 do (FriendActions) */
  actions?: ReactNode;
  /** 求助: what TA asks for now (HelpRows) */
  help?: ReactNode;
  /** 特别关注 TA, or not */
  onStar?: () => void;
  /** 游戏里也加个好友, under each of their games */
  gameExtra?: (game: Game) => ReactNode;
  onFind: (roachIndex: number) => void;
  onUnfriend: () => void;
  onSafety: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { profile } = friend;
  // a guide: no games or history to show, and nobody to block
  const guideOf = guideById(friend.id);
  const guide = Boolean(guideOf);
  return (
    <Sheet title="触须之交" onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <RoachIcon color={profile.color} size={52} avatar={profile.avatar} friend />
        <div>
          <strong>{profile.displayName}</strong>
          <WornPill profile={profile} />
          <p className="hint">{ago(friend.since)}成为触须之交</p>
        </div>
        {onStar && (
          <button type="button" className={`star-btn${friend.star !== null ? " on" : ""}`} onClick={onStar} aria-pressed={friend.star !== null}>
            {friend.star !== null ? "★ 已特别关注" : "☆ 特别关注"}
          </button>
        )}
      </div>
      {guideOf ? <p className="hint">{guideOf.note}</p> : <ProfileDetails profile={profile} gameExtra={gameExtra} />}
      {help}
      {actions}

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

      {!guide && (
        <>
          <h3>最近 {INBOX_DAYS} 天发表了 {friend.declarations} 次独立宣言</h3>

          <h3>社交记录</h3>
          {friend.history.length === 0 && <p className="hint">最近还没有动静。</p>}
          {friend.history.map((e, i) => (
            <div className="event" key={i}>
              <span>{eventText(e)}</span>
              <span className="muted">{ago(e.at)}</span>
            </div>
          ))}
        </>
      )}

      <button className="danger wide" style={{ marginTop: 20 }} onClick={onUnfriend}>
        解除触须之交
      </button>
      <p className="hint">
        {friend.id === AMIYA_ID
          ? AMIYA_UNFRIEND
          : friend.id === PERLICA_ID
            ? PERLICA_UNFRIEND
            : friend.id === MINGHE_ID
              ? "解除后他还会在各地走，大胆碰他一下就能再成为触须之交。"
              : guide
                ? "解除后她还在太阳岛守着火，大胆碰她一下就能再握一次手。"
                : "解除后你们互相看不到对方的蟑螂和记录了；想再成为触须之交，要重新互相大胆碰一次。"}
      </p>
      {!guide && (
        <button className="pill" style={{ marginTop: 14 }} onClick={onSafety}>
          拉黑或举报 TA
        </button>
      )}
    </Sheet>
  );
}
