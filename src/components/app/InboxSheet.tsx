"use client";

import { useState, type ReactNode } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { AMIYA, AMIYA_ID, amiyaLine } from "@/lib/amiya";
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
import { capCount, INBOX_TABS, noticeTitle, tabLabel, tabOf, type InboxTab } from "@/lib/inboxTabs";
import { PERLICA_ID, perlicaText, perlicaUnfriend } from "@/lib/perlica";
import { MINGHE_ID, mingheText, tripStops } from "@/lib/minghe";
import { SI_ID, siText } from "@/lib/si";
import { talulahText } from "@/lib/talulah";
import type { PublicProfile } from "@/lib/profile";
import { DECLARATION_DAYS, DECLARATION_RADIUS_KM, INBOX_DAYS } from "@/lib/rules";
import { APPEAL_MAX, APPEAL_MIN } from "@/lib/safety";
import type { LngLat } from "@/lib/types";
import { boldOnly, type Friend, type InboxItem, type StaffAppeal } from "@/lib/world/types";
import { BadgePill, TheirBadges } from "./Badges";
import OperatorNames from "./OperatorNames";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

/** What can be touched back from 消息: a touch, a declaration, or a reaction to yours */
type Answerable = Extract<InboxItem, { kind: "touch" | "declaration" | "reaction" }>;

/** What ending it with 阿米娅向导 means; also the question before it */
export const amiyaUnfriend = () => T.inbox.unfriend.amiya;

export function ago(t: number, now = Date.now()) {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return T.inbox.ago.now;
  if (s < 3600) return fmt(T.inbox.ago.minutes, { n: Math.floor(s / 60) });
  if (s < 86400) return fmt(T.inbox.ago.hours, { n: Math.floor(s / 3600) });
  return fmt(T.inbox.ago.days, { n: Math.floor(s / 86400) });
}

function touchText(item: Extract<InboxItem, { kind: "touch" }>) {
  const who = item.from?.displayName;
  if (item.bold && who) {
    if (item.target === "touch") return fmt(T.inbox.touch.boldBack, { who });
    if (item.target === "declaration") return fmt(T.inbox.touch.boldAfterReact, { who });
    if (item.target === "reaction") return fmt(T.inbox.touch.boldAfterReply, { who });
    if (item.target === "clone") return fmt(T.inbox.touch.boldClone, { who });
    if (item.target === "ink") return fmt(T.inbox.touch.boldInk, { who });
    return fmt(T.inbox.touch.bold, { who });
  }
  if (item.target === "touch") return T.inbox.touch.sneakyBack;
  if (item.target === "declaration") return T.inbox.touch.sneakyAfterReact;
  if (item.target === "reaction") return T.inbox.touch.sneakyAfterReply;
  if (item.target === "clone") return T.inbox.touch.sneakyClone;
  if (item.target === "ink") return T.inbox.touch.sneakyInk;
  return T.inbox.touch.sneaky;
}

/** Who poked you while you slept, among the pokes you have not seen: 「A」, 「A 和 B」 or 「A、B 等 N 位触须之交」; "" for nobody. */
export function pokedBy(items: InboxItem[]) {
  const names = [...new Set(items.flatMap((i) => (i.kind === "poke" && !i.seen ? [i.from.displayName] : [])))];
  if (names.length <= 2) return names.join(T.inbox.pokedBy.and);
  return fmt(T.inbox.pokedBy.many, { names: names.slice(0, 2).join(T.common.listSep), n: names.length });
}

/** What happened with a visiting clone (串门), by who did it */
function visitText(item: Extract<InboxItem, { kind: "visit" }>) {
  const who = item.from.displayName;
  switch (item.event) {
    case "came":
      return fmt(T.inbox.visit.came, { who });
    case "sentHome":
      return fmt(T.inbox.visit.sentHome, { who });
    case "hostMoved":
      return fmt(T.visit.moved, { who });
    case "hostRemoved":
      return fmt(T.visit.removed, { who });
    case "closed":
      return fmt(T.inbox.visit.closed, { who });
  }
}

/** 游戏里也加个好友, by who */
function gameText(item: Extract<InboxItem, { kind: "game" }>) {
  const who = item.from.displayName;
  const game = GAME_NAMES[item.game];
  if (item.event === "added") return fmt(T.inbox.game.added, { who, game });
  if (item.event === "want") return fmt(T.inbox.game.want, { who });
  return fmt(T.inbox.game.sent, { who, game, server: item.server ? fmt(T.common.inParens, { text: item.server }) : "" });
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
  if (appeal.state === "sent") return <p className="hint appeal-done">{T.inbox.appeal.sent}</p>;
  if (appeal.state === "answered") return null;
  if (!writing) {
    return (
      <div className="row-actions">
        <button className="pill" onClick={() => setWriting(true)}>
          {T.inbox.appeal.ask}
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
        placeholder={fmt(T.inbox.appeal.placeholder, { min: APPEAL_MIN, max: APPEAL_MAX })}
        aria-label={T.inbox.appeal.label}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row-actions">
        <button className="pill dark" disabled={busy || length < APPEAL_MIN} onClick={send}>
          {T.inbox.appeal.submit}
        </button>
        <button className="pill" disabled={busy} onClick={() => setWriting(false)}>
          {T.common.neverMind}
        </button>
      </div>
      <p className="hint">{T.inbox.appeal.once}</p>
    </div>
  );
}

/** What one of 阿米娅向导's touches says, in her own words. */
function amiyaText(item: Extract<InboxItem, { kind: "amiya" }>, games: Game[]) {
  if (item.greet) return fmt(T.inbox.amiya.greet, { name: AMIYA.name, line: amiyaLine("greet", games) });
  return item.bold
    ? fmt(T.inbox.amiya.bold, { name: AMIYA.name, line: amiyaLine("bold", games) })
    : fmt(T.inbox.amiya.sneaky, { name: AMIYA.name, line: amiyaLine("sneaky", games) });
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
      <span className="done">{T.inbox.reply.done}</span>
    ) : item.waits === "all" ? (
      // you touched TA in the last day: touching back waits, so touches never go back and forth
      <span className="done">{T.inbox.reply.today}</span>
    ) : replying === item.id ? (
      <>
        {!boldOnly(item.waits) && (
          <button className="pill" onClick={() => reply(item.id, false)}>
            {T.inbox.reply.sneaky}
          </button>
        )}
        <button className="pill dark" onClick={() => reply(item.id, true)}>
          {T.inbox.reply.bold}
        </button>
        <button className="pill" onClick={() => setReplying(null)}>
          {T.common.neverMind}
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
    // TA touched one of your roaches on the map, or your ink roach at 缘缘庄
    const yours = item.kind === "touch" && (item.target === "main" || item.target === "clone" || item.target === "ink");
    const ink = item.kind === "touch" && item.target === "ink";
    const text =
      item.waits === "reveal"
        ? fmt(T.inbox.reply.revealWaits, { yours: yours ? (ink ? T.inbox.reply.revealYoursInk : T.inbox.reply.revealYours) : "" })
        : item.kind !== "touch"
          ? null
          : item.waits === "sneaky"
            ? T.inbox.reply.sneakyWaits
            : yours
              ? ink
                ? T.inbox.reply.yoursNoteInk
                : T.inbox.reply.yoursNote
              : null;
    return text && <p className="hint">{text}</p>;
  };

  const meta = (item: InboxItem, target: string, who: string | null) => (
    <div className="meta">
      {ago(item.at)}
      {/* a guide is nobody, so there is nobody to block */}
      {!isGuideItem(item.id) && (
        <button className="link" onClick={() => onSafety(target, who)}>
          {T.inbox.blockReport}
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
          <div className="staff-from">{T.inbox.staff}</div>
          <div>{item.text}</div>
          {item.appeal && <AppealRow appeal={item.appeal} onAppeal={(actionId, text) => onAppeal(item.id, actionId, text)} />}
          <div className="meta">{ago(item.at)}</div>
        </div>
      );
    }
    if (item.kind === "friend") {
      return (
        <div key={item.id} className={cls}>
          <div>{fmtParts(T.inbox.friendsNow, { name: item.from.displayName })}</div>
          {meta(item, `friend:${item.friendId}`, item.from.displayName)}
          {friendIds.has(item.friendId) && (
            <div className="row-actions">
              <button className="pill dark" onClick={() => onOpenFriend(item.friendId)}>
                {T.common.seeThem}
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
          <div>{item.kind === "poke" ? fmt(T.inbox.poke.asleep, { who }) : fmt(T.inbox.poke.woke, { who })}</div>
          {meta(item, item.kind === "poke" ? item.id : `friend:${item.friendId}`, who)}
          {friendIds.has(item.friendId) && (
            <div className="row-actions">
              <button className="pill dark" onClick={() => onOpenFriend(item.friendId)}>
                {T.common.seeThem}
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
            <span className="done">{T.inbox.sanity.told}</span>
          ) : item.answer === "ok" ? (
            <span className="done">{T.inbox.sanity.ok}</span>
          ) : (
            <>
              <button className="pill dark" disabled={busy} onClick={() => act(item.id, () => friendly.answerSanity(item.id, "done"))}>
                {T.inbox.sanity.done}
              </button>
              <button className="pill" disabled={busy} onClick={() => act(item.id, () => friendly.answerSanity(item.id, "ok"))}>
                {T.inbox.sanity.ok}
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
              {full ? fmt(T.common.actsFull, { n: FRIEND_ACTS_PER_DAY }) : GESTURE_BACK[g]}
            </button>
          );
        }
      } else if (item.kind === "visit") {
        text = visitText(item);
        if (item.tip) note = <p className="hint">{T.inbox.visit.doorstep}</p>;
        if (item.event === "came" && item.spot) {
          const spot = item.spot;
          actions = (
            <>
              <button className="pill dark" onClick={() => friendly.look(spot)}>
                {T.common.goSee}
              </button>
              {friend && (
                <button className="pill" disabled={busy} onClick={() => act(item.id, () => friendly.sendHome(item.friendId))}>
                  {T.visit.sendHome}
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
                  {T.visit.follow}
                </button>
              )}
              <button className="pill" disabled={busy} onClick={() => act(item.id, () => friendly.goHome(clone))}>
                {T.visit.goHome}
              </button>
            </>
          );
          if (item.event === "hostMoved") note = <p className="hint">{T.inbox.visit.followNote}</p>;
        }
      } else if (item.kind === "game") {
        text = gameText(item);
        if (item.event === "ask") {
          actions = item.answered ? (
            <span className="done">{T.inbox.game.told}</span>
          ) : friend ? (
            <button className="pill dark" disabled={busy} onClick={() => act(item.id, () => friendly.gameAdded(item.id))}>
              {T.inbox.game.addedToo}
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
                {T.common.seeThem}
              </button>
            )}
          </div>
        </div>
      );
    }
    if (item.kind === "amiya" || item.kind === "perlica" || item.kind === "talulah" || item.kind === "minghe" || item.kind === "si") {
      const text =
        item.kind === "amiya"
          ? amiyaText(item, games)
          : item.kind === "perlica"
            ? perlicaText(item)
            : item.kind === "talulah"
              ? talulahText(item, games)
              : item.kind === "minghe"
                ? mingheText(item)
                : siText(item);
      return (
        <div key={item.id} className={cls}>
          <div>{text}</div>
          {/* the stations the clone rode through */}
          {item.kind === "minghe" && item.line === "trip" && item.stop !== null && (
            <p className="minghe-trip">{tripStops(item.stop).join(T.common.listSep)}</p>
          )}
          {meta(item, item.id, null)}
          <div className="row-actions">
            {item.ignored ? (
              <span className="done">{T.inbox.crawled}</span>
            ) : item.replied ? (
              <span className="done">{fmtParts(T.inbox.touchedThem, { them: item.kind === "minghe" ? T.inbox.him : T.inbox.her })}</span>
            ) : (
              <>
                <button className="pill" disabled={replying === item.id} onClick={() => {
                  setReplying(item.id);
                  reply(item.id, false);
                }}>
                  {T.common.sneakyBack}
                </button>
                <button className="pill dark" disabled={replying === item.id} onClick={() => {
                  setReplying(item.id);
                  reply(item.id, true);
                }}>
                  {T.common.boldBack}
                </button>
                <button className="pill" onClick={() => onIgnore(item.id)}>
                  {T.inbox.crawl}
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
                {T.inbox.viewProfile}
              </button>
            )}
            {item.ignored ? (
              <span className="done">{T.inbox.crawled}</span>
            ) : (
              <>
                {replyButtons(item, T.inbox.touchBack)}
                {!item.replied && replying !== item.id && (
                  <button className="pill" onClick={() => onIgnore(item.id)}>
                    {T.inbox.crawlIgnore}
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
            <div>{item.reaction.id === "birthday" ? fmt(T.inbox.birthday.wish, { who }) : fmt(T.inbox.birthday.reacted, { who, text: item.reaction.text })}</div>
            {meta(item, item.id, who)}
            <div className="row-actions">{replyButtons(item, T.inbox.touchThem)}</div>
            {replyNote(item)}
          </div>
        );
      }
      return (
        <div key={item.id} className={cls}>
          <div>{fmtParts(T.inbox.reactedTo, { text: item.text })}</div>
          <div className="quote">{item.reaction.text}</div>
          {meta(item, item.id, null)}
          <div className="row-actions">{replyButtons(item, T.inbox.touchThem)}</div>
          {replyNote(item)}
        </div>
      );
    }
    return (
      <div key={item.id} className={cls}>
        <div>
          {item.from ? fmt(T.inbox.declared.friend, { name: item.from.displayName }) : fmt(T.inbox.declared.near, { km: DECLARATION_RADIUS_KM })}
        </div>
        <div className="quote">{fmtParts(T.common.quoted, { text: item.text })}</div>
        {meta(item, item.id, item.from?.displayName ?? null)}
        {item.reaction ? (
          <div className="done">{fmtParts(T.inbox.youReplied, { text: item.reaction.text })}</div>
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
        {item.from && !item.reaction && <p className="hint">{T.inbox.seesYou}</p>}
        <div className="row-actions">{replyButtons(item, T.inbox.touchThem)}</div>
        {replyNote(item)}
      </div>
    );
  };

  return (
    <Sheet title={notice ? noticeTitle(items) : T.inbox.title} onClose={onClose}>
      {suspendedUntil && <p className="suspended-banner">{fmtParts(T.inbox.suspended, { until: beijingDayWords(suspendedUntil) })}</p>}
      <div className="seg tabs four" role="tablist">
        {INBOX_TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => onTab(t)}>
            {tabLabel(t)}
            {/* declarations sent nearby count in yellow, as the speaker on the envelope; the rest came to you, in red */}
            {unseenIn(t) > 0 && <span className={`badge${t === "declarations" ? " say" : ""}`}>{capCount(unseenIn(t))}</span>}
          </button>
        ))}
      </div>

      {tab === "replies" && shown.length === 0 && (
        <p className="hint">{T.inbox.empty.replies}</p>
      )}
      {tab === "declarations" && shown.length === 0 && <p className="hint">{fmt(T.inbox.empty.declarations, { days: DECLARATION_DAYS })}</p>}
      {tab === "touches" && shown.length === 0 && <p className="hint">{T.inbox.empty.touches}</p>}
      {shown.map(message)}

      {tab === "friends" && (
        <>
          {friends.length === 0 && (
            <p className="hint">{T.common.noFriends}</p>
          )}
          {friends.map((f) => (
            <button key={f.id} className="list-row friend-row" onClick={() => onOpenFriend(f.id)}>
              <RoachIcon color={f.profile.color} size={40} avatar={f.profile.avatar} friend />
              <div>
                <strong>{f.profile.displayName}</strong>
                <p className="muted">
                  {guideById(f.id)
                    ? fmt(T.inbox.friendRow.guide, { ago: ago(f.since), note: guideById(f.id)!.note })
                    : fmt(T.inbox.friendRow.player, { ago: ago(f.since), roaches: f.roaches.length, declarations: f.declarations })}
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
        <p className="hint">{T.inbox.profile.noGames}</p>
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
            {fmtNodes(T.inbox.profile.favourites, { list: profile.favourites[g].length ? <OperatorNames game={g} names={profile.favourites[g]} /> : T.inbox.profile.none })}
          </dd>
          {g === "arknights" && profile.support && (
            <dd>
              {fmtNodes(T.inbox.profile.support, { list: <OperatorNames game="arknights" names={profile.support} /> })}
            </dd>
          )}
          {profile.uid?.[g] && (
            <dd>
              {fmtNodes(T.common.uid, { server: serverName(g, profile.uidServer?.[g]) ? `${serverName(g, profile.uidServer?.[g])} ` : "", uid: <span className="uid">{profile.uid[g]}</span> })}
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
    <Sheet title={T.inbox.profile.title} onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <RoachIcon color={profile.color} size={52} avatar={profile.avatar} />
        <div>
          <strong>{profile.displayName}</strong>
          <WornPill profile={profile} />
        </div>
      </div>
      <ProfileDetails profile={profile} />
      <p className="hint" style={{ marginTop: 16 }}>
        {T.inbox.profile.why}
      </p>
      <button className="pill" style={{ marginTop: 14 }} onClick={onSafety}>
        {T.inbox.blockOrReport}
      </button>
    </Sheet>
  );
}

function eventText(e: Friend["history"][number]) {
  switch (e.kind) {
    case "touched":
      if (e.you) return e.bold ? T.inbox.history.touchedYouBold : T.inbox.history.touchedYouSneaky;
      return e.bold ? T.inbox.history.touchedBold : T.inbox.history.touchedSneaky;
    case "touchedBy":
      if (e.you) return e.bold ? T.inbox.history.touchedByYouBold : T.inbox.history.touchedByYouSneaky;
      return e.bold ? T.inbox.history.touchedByBold : T.inbox.history.touchedBySneaky;
    case "declared":
      return fmt(T.inbox.history.declared, { text: e.text });
    case "befriended":
      return e.you ? T.inbox.history.befriendedYou : T.inbox.history.befriended;
    case "support":
      return T.inbox.history.support;
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
    <Sheet title={T.common.friends} onBack={onBack} onClose={onClose}>
      <div className="who-card">
        <RoachIcon color={profile.color} size={52} avatar={profile.avatar} friend />
        <div>
          <strong>{profile.displayName}</strong>
          <WornPill profile={profile} />
          <p className="hint">{fmtParts(T.inbox.friendsSince, { ago: ago(friend.since) })}</p>
        </div>
        {onStar && (
          <button type="button" className={`star-btn${friend.star !== null ? " on" : ""}`} onClick={onStar} aria-pressed={friend.star !== null}>
            {friend.star !== null ? T.inbox.starred : T.inbox.star}
          </button>
        )}
      </div>
      {guideOf ? <p className="hint">{guideOf.card ?? guideOf.note}</p> : <ProfileDetails profile={profile} gameExtra={gameExtra} />}
      {help}
      {actions}

      <h3>{T.inbox.roaches}</h3>
      {friend.roaches.length === 0 && <p className="hint">{T.inbox.noRoaches}</p>}
      {friend.roaches.map((r, i) => (
        <div className="list-row" key={r.id}>
          <RoachIcon color={r.color} size={36} avatar={r.avatar} friend clone={r.clone} />
          <div>
            <strong>{r.clone ? fmt(T.common.cloneN, { n: i }) : T.common.main}</strong>
          </div>
          <div className="row-actions">
            <button className="pill" onClick={() => onFind(i)}>
              {T.common.find}
            </button>
          </div>
        </div>
      ))}

      {!guide && (
        <>
          <h3>{fmtParts(T.inbox.declaredRecently, { days: INBOX_DAYS, n: friend.declarations })}</h3>

          <h3>{T.inbox.history.title}</h3>
          {friend.history.length === 0 && <p className="hint">{T.inbox.history.empty}</p>}
          {friend.history.map((e, i) => (
            <div className="event" key={i}>
              <span>{eventText(e)}</span>
              <span className="muted">{ago(e.at)}</span>
            </div>
          ))}
        </>
      )}

      <button className="danger wide" style={{ marginTop: 20 }} onClick={onUnfriend}>
        {T.inbox.unfriend.button}
      </button>
      <p className="hint">
        {friend.id === AMIYA_ID
          ? amiyaUnfriend()
          : friend.id === PERLICA_ID
            ? perlicaUnfriend()
            : friend.id === MINGHE_ID
              ? T.inbox.unfriend.minghe
              : friend.id === SI_ID
                ? T.inbox.unfriend.si
                : guide
                  ? T.inbox.unfriend.talulah
                  : T.inbox.unfriend.player}
      </p>
      {!guide && (
        <button className="pill" style={{ marginTop: 14 }} onClick={onSafety}>
          {T.inbox.blockOrReport}
        </button>
      )}
    </Sheet>
  );
}
