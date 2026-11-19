"use client";

import { useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import type { InviteSent } from "@/lib/listen";
import type { SquadListen, SquadMember, SquadRoom } from "@/lib/squad";
import { inviteSquadToListen, joinSquadListen, laterAt, listenRoomNow, useListenRoom } from "../listening";
import { loadSquadRoom } from "./squading";
import "./squadListen.css";

/**
 * 卫戍的一起听 (src/lib/squad.ts SquadListen): the room's songs are its host's own 一起听, the 听歌 player itself. In
 * the room's sheet a row in its place of before (ListenRow): to the host 「邀请大家一起听」 (leaving another's 一起听
 * first, asked), or, once it is on, what it plays, how many of the room listen, who said 下次吧, and 打开; to anyone
 * else nothing until it is on, then the invitation to answer (一起听, 下次吧: not joining is fine), 加入 (after 下次吧, or
 * coming in later) or 打开. On the bar of a round ♪ (ListenNote) opens 听歌's player, or, where there is something to
 * do first, a card over the bar (ListenAsk): the host's invitation, or the way in. Only to one 听歌 is open to (hear).
 * 一起听 itself does the rest (src/components/app/listening.ts): its own rules for 点歌, 短评 and who may skip.
 */

/** A phone (a touch screen): the game stops the page's songs as one switches to it */
const touchScreen = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/** What the invitations came to, in a line: none to send (nobody but 人机), all sent, or the first refusal */
export function squadSentWords(sent: InviteSent[]) {
  if (!sent.length) return T.squad.listen.nobody;
  const bad = sent.filter((x) => !x.ok);
  if (!bad.length) return T.listen.sent;
  return fmt(T.listen.sentSome, { n: bad.length, why: bad[0].why ?? T.map.common.tryAgain });
}

/** The names of those of the room with these numbers, in a list */
const namesOf = (members: readonly SquadMember[], hs: readonly number[]) =>
  hs
    .map((h) => members.find((m) => m.h === h)?.name)
    .filter((n): n is string => Boolean(n))
    .join(T.common.listSep);

/** What the row and the cards say of it, by who looks and how it stands */
export function listenWords(room: Pick<SquadRoom, "host" | "members">, l: SquadListen | null) {
  const host = room.members.find((m) => m.host)?.name ?? "";
  if (room.host) {
    if (!l) return { title: T.squad.listen.title, sub: T.squad.listen.sub };
    const people = room.members.filter((m) => !m.bot).length;
    const later = l.later?.length ? fmt(T.squad.listen.later, { names: namesOf(room.members, l.later) }) : null;
    const bots = room.members.some((m) => m.bot) ? T.squad.listen.noBots : null;
    return {
      title: l.song ? fmt(T.squad.listen.on, { song: l.song }) : T.squad.listen.onNone,
      sub: [fmt(T.squad.listen.hostSub, { n: l.ours, m: people }), later, bots].filter(Boolean).join(T.squad.dot),
    };
  }
  if (!l) return null;
  if (l.you === "in") return { title: l.song ? fmt(T.squad.listen.on, { song: l.song }) : T.squad.listen.onNone, sub: fmt(T.squad.listen.inSub, { n: l.n }) };
  if (l.you === "invited") return { title: fmt(T.squad.listen.invited, { host }), sub: l.song ? fmt(T.squad.listen.invitedSub, { song: l.song, n: l.n }) : fmt(T.squad.listen.hostingNone, { n: l.n }) };
  return { title: fmt(T.squad.listen.hosting, { host }), sub: l.song ? fmt(T.squad.listen.hostingSub, { song: l.song, n: l.n }) : fmt(T.squad.listen.hostingNone, { n: l.n }) };
}

/**
 * What a tap does, with the questions first where there are any: the host's invitation (out of another's 一起听
 * first), the way in (换过去 when in another 一起听), 下次吧. said: what to tell the player after it; done: it went
 */
function useListenActs(room: SquadRoom, onListen: () => void, said: (text: string) => void, done?: () => void) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<"leave" | "switch" | null>(null);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const invite = (asked = false) => {
    const mine = listenRoomNow();
    if (!asked && mine && !mine.host) return setAsking("leave");
    setAsking(null);
    void run(async () => {
      const res = await inviteSquadToListen();
      if (!res) return;
      said(squadSentWords(res.sent));
      void loadSquadRoom().catch(() => {});
      done?.();
      // nothing played before: the player, to pick a song
      if (res.opened && !mine) onListen();
    });
  };
  const join = (asked = false) => {
    const mine = listenRoomNow();
    if (!asked && mine && mine.id !== room.listen?.room) return setAsking("switch");
    setAsking(null);
    void run(async () => {
      if (!(await joinSquadListen())) return;
      void loadSquadRoom().catch(() => {});
      done?.();
    });
  };
  const later = () => {
    const id = room.listen?.invite;
    if (!id) return;
    void run(async () => {
      if (!(await laterAt(id))) return;
      void loadSquadRoom().catch(() => {});
      done?.();
    });
  };
  return { busy, asking, setAsking, invite, join, later };
}

/** The question before a tap goes on: out of another's 一起听 (the host), or over to this one (anyone else) */
function Asked({ acts }: { acts: ReturnType<typeof useListenActs> }) {
  if (acts.asking === "leave") {
    return (
      <div className="sq-lask" role="alertdialog" aria-label={T.squad.listen.leaveAsk}>
        <b>{T.squad.listen.leaveAsk}</b>
        <small>{T.squad.listen.leaveSub}</small>
        <span className="b">
          <button type="button" className="dark" disabled={acts.busy} onClick={() => acts.invite(true)}>
            {T.squad.listen.leaveYes}
          </button>
          <button type="button" className="ghost" onClick={() => acts.setAsking(null)}>
            {T.squad.listen.leaveNo}
          </button>
        </span>
      </div>
    );
  }
  if (acts.asking === "switch") {
    return (
      <div className="sq-lask" role="alertdialog" aria-label={T.listen.switchAsk}>
        <b>{T.listen.switchAsk}</b>
        <span className="b">
          <button type="button" className="dark" disabled={acts.busy} onClick={() => acts.join(true)}>
            {T.listen.switchYes}
          </button>
          <button type="button" className="ghost" onClick={() => acts.setAsking(null)}>
            {T.listen.switchNo}
          </button>
        </span>
      </div>
    );
  }
  return null;
}

/** The buttons of the row or a card, as it stands: the host's invitation or 打开; 一起听 · 下次吧, 加入, or 打开 */
function Buttons({ room, acts, onListen, card }: { room: SquadRoom; acts: ReturnType<typeof useListenActs>; onListen: () => void; card?: boolean }) {
  const l = room.listen;
  if (room.host && !l) {
    return (
      <button type="button" className="dark" disabled={acts.busy} onClick={() => acts.invite()}>
        {T.squad.listen.invite}
      </button>
    );
  }
  if (!l) return null;
  if (l.you === "in") {
    return (
      <button type="button" className="ghost" onClick={onListen}>
        {T.squad.listen.open}
      </button>
    );
  }
  if (l.you === "invited") {
    return (
      <>
        <button type="button" className="acc" disabled={acts.busy} onClick={() => acts.join()}>
          {T.squad.listen.join}
        </button>
        <button type="button" className="ghost" disabled={acts.busy} onClick={acts.later}>
          {T.squad.listen.notNow}
        </button>
      </>
    );
  }
  return (
    <button type="button" className={card ? "acc" : "dark"} disabled={acts.busy} onClick={() => acts.join()}>
      {T.squad.listen.add}
    </button>
  );
}

/** The row in the room's sheet (in the host's songs' place of before); nothing to anyone else until it is on */
export function ListenRow({ room, onListen, onToast }: { room: SquadRoom; onListen: () => void; onToast: (text: string) => void }) {
  const acts = useListenActs(room, onListen, onToast);
  if (!room.hear) return null;
  const words = listenWords(room, room.listen);
  if (!words) return null;
  const l = room.listen;
  return (
    <div className={`sq-lsn${l ? " on" : ""}`}>
      <div className="top">
        <span className={`dot${l?.playing ? " go" : ""}`} aria-hidden="true" />
        <span className="t">
          <b>{words.title}</b>
          <small>{words.sub}</small>
        </span>
        <span className="acts">
          <Buttons room={room} acts={acts} onListen={onListen} />
        </span>
      </div>
      {l?.you === "invited" && <p className="note">{T.squad.listen.either}</p>}
      {l && touchScreen() && <p className="note">{T.squad.listen.phone}</p>}
      <Asked acts={acts} />
    </div>
  );
}

/**
 * ♪ on the bar of a round: 一起听 not on, ♪ (the host: a card to invite the room; anyone else: their own 听歌); in it,
 * teal ♪ n (听歌's player); not in it, ♪ 加入 (the card to go in). In another 一起听 than the room's, teal ♪ n of that
 * one (its player). onCard: the card over the bar, or none
 */
export function ListenNote({ room, onListen, onCard }: { room: SquadRoom; onListen: () => void; onCard: () => void }) {
  const mine = useListenRoom();
  if (!room.hear) return null;
  const l = room.listen;
  const elsewhere = mine && mine.id !== l?.room ? mine : null;
  if (elsewhere) {
    const n = elsewhere.members.filter((m) => m.state === "in").length;
    return (
      <button type="button" className="sq-note in" aria-label={fmt(T.squad.listen.noteInLabel, { n })} onClick={onListen}>
        {fmt(T.squad.listen.noteIn, { n })}
      </button>
    );
  }
  if (l?.you === "in") {
    return (
      <button type="button" className="sq-note in" aria-label={fmt(T.squad.listen.noteInLabel, { n: l.n })} onClick={onListen}>
        {fmt(T.squad.listen.noteIn, { n: l.n })}
      </button>
    );
  }
  if (l) {
    return (
      <button type="button" className="sq-note join" aria-label={T.squad.listen.noteJoinLabel} aria-haspopup="dialog" onClick={onCard}>
        {T.squad.listen.noteJoin}
      </button>
    );
  }
  return (
    <button type="button" className="sq-note" aria-label={T.squad.listen.noteLabel} aria-haspopup={room.host ? "dialog" : undefined} onClick={room.host ? onCard : onListen}>
      {T.squad.listen.note}
    </button>
  );
}

/**
 * The card over the bar of a round, from ♪: to the host, the invitation to the room (先不 lets it be); to anyone else,
 * the way into 卫戍的一起听 as the invitation's card on the map says it (not joining is fine)
 */
export function ListenAsk({
  room,
  style,
  onListen,
  onToast,
  onClose,
}: {
  room: SquadRoom;
  style?: CSSProperties;
  onListen: () => void;
  onToast: (text: string) => void;
  onClose: () => void;
}) {
  const acts = useListenActs(room, onListen, onToast, onClose);
  const l = room.listen;
  const words = room.host && !l ? { title: T.squad.listen.title, sub: T.squad.listen.cardSub } : listenWords(room, l);
  if (!words || (l && l.you === "in")) return null;
  return (
    <div className="sq-lcard" role="dialog" aria-label={words.title} style={style}>
      <b>{words.title}</b>
      <small>{words.sub}</small>
      {!room.host && <small className="either">{T.squad.listen.either}</small>}
      {acts.asking ? (
        <Asked acts={acts} />
      ) : (
        <span className="b">
          <Buttons room={room} acts={acts} onListen={onListen} card />
          {(room.host || l?.you !== "invited") && (
            <button type="button" className="ghost" onClick={onClose}>
              {T.squad.listen.cardNo}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
