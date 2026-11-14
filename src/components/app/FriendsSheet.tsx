"use client";

import { useEffect, useState } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { BATCH_ACTS, BATCH_NAMES, FRIEND_ACTS_PER_DAY, type BatchAct } from "@/lib/friendly";
import type { Friend, HelpBoard } from "@/lib/world/types";
import { MyHelp, TheirHelp } from "./HelpRows";
import { ago } from "./InboxSheet";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

/** The 触须之交 mark: two feelers that met, under a heart, as when two roaches become 触须之交; arch: the feelers' colour */
export function FriendsMark({ size = 19, arch = "#1b1d22" }: { size?: number; arch?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5 22 C5 15.5 8 12.2 12 12.2 M19 22 C19 15.5 16 12.2 12 12.2" fill="none" stroke={arch} strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12 11.4 C8.2 8.7 6.7 6.6 6.7 4.5 C6.7 2.9 8 1.6 9.6 1.6 C10.6 1.6 11.5 2.2 12 3 C12.5 2.2 13.4 1.6 14.4 1.6 C16 1.6 17.3 2.9 17.3 4.5 C17.3 6.6 15.8 8.7 12 11.4 Z"
        fill="#ff4f8b"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Why one cannot have this 一键 now, or null */
function cannot(f: Friend, act: BatchAct): string | null {
  const b = f.between;
  if (!b) return T.common.guides;
  // 送券: asleep too, and none of the day's FRIEND_ACTS_PER_DAY
  if (act === "gift") return b.gift === "ok" ? null : b.gift === "given" ? T.friends.gift.given : b.gift === "full" ? T.friends.gift.full : T.friends.gift.closed;
  if (act === "sanity") return b.done.sanity ? T.friends.sanityDone : b.actsLeft <= 0 ? fmt(T.common.actsFull, { n: FRIEND_ACTS_PER_DAY }) : null;
  if (b.asleep) return T.common.asleep;
  return b.actsLeft <= 0 ? fmt(T.common.actsFull, { n: FRIEND_ACTS_PER_DAY }) : null;
}

/** The send button: 「和 12 位贴贴」 */
function sendLabel(act: BatchAct, n: number) {
  if (act === "luck") return fmt(T.friends.batch.luck, { n });
  if (act === "sanity") return fmt(T.friends.batch.sanity, { n });
  if (act === "gift") return fmt(T.friends.batch.gift, { n });
  return fmt(T.friends.batch.gesture, { n, act: BATCH_NAMES[act] });
}

/**
 * Everyone you are 触须之交 with: 特别关注 first, then the guides, then everyone else, as a grid
 * of how they look on the map; a tap opens one (FriendView), and going back comes here again.
 * On top: 一键 (贴贴 · 击掌 · 吸欧气 · 催理智, and 送券 while any of them may be given a 寻访券,
 * for many at once: pick, everyone who can have it ticked), then 求助: your 触须之交's requests
 * and your own (src/lib/help.ts), which never pop up anywhere else. pick: a 一键 to open on.
 */
export default function FriendsSheet({
  friends,
  help,
  busy,
  pick,
  onOpen,
  onBatch,
  onAskHelp,
  onAnswerHelp,
  onCloseHelp,
  onCopyUid,
  onClose,
}: {
  friends: Friend[];
  /** 求助, once loaded */
  help: HelpBoard | null;
  busy: boolean;
  /** Open picking for this 一键 (送券, from 寻访) */
  pick?: BatchAct;
  onOpen: (id: string) => void;
  onBatch: (act: BatchAct, friendIds: string[]) => void;
  onAskHelp: () => void;
  onAnswerHelp: (requestId: string, clues?: number[]) => void;
  onCloseHelp: (requestId: string) => void;
  onCopyUid: (uid: string) => void;
  onClose: () => void;
}) {
  const people = friends.filter((f) => f.between);
  // picking for a 一键: everyone who can have it, ticked
  const ticked = (a: BatchAct) => new Set(people.filter((f) => !cannot(f, a)).map((f) => f.id));
  const [act, setAct] = useState<BatchAct | null>(pick ?? null);
  const [chosen, setChosen] = useState<Set<string>>(() => (pick ? ticked(pick) : new Set()));
  const [askedOpen, setAskedOpen] = useState(true);
  const starred = people.some((f) => f.star !== null);
  const asking = new Set((help?.theirs ?? []).map((r) => r.friendId));
  // 送券 only while any of them may be given a 寻访券 (Friend.between.gift)
  const acts = BATCH_ACTS.filter((a) => a !== "gift" || people.some((f) => f.between?.gift));
  // opened on a 一键 before the list came: tick once it does
  const [waiting, setWaiting] = useState(Boolean(pick) && people.length === 0);
  useEffect(() => {
    if (!waiting || !act || people.length === 0) return;
    setWaiting(false);
    setChosen(ticked(act));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, act, people.length]);

  const startPick = (a: BatchAct) => {
    setAct(a);
    setChosen(ticked(a));
  };
  const onlyStarred = () => act && setChosen(new Set(people.filter((f) => f.star !== null && !cannot(f, act)).map((f) => f.id)));
  const flip = (id: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const theirs = help?.theirs ?? [];
  const mine = help?.mine ?? [];
  return (
    <Sheet
      title={T.common.friends}
      onClose={onClose}
      footer={
        act && (
          <div className="batch-bar">
            <button type="button" className="primary" disabled={busy || chosen.size === 0} onClick={() => onBatch(act, [...chosen])}>
              {sendLabel(act, chosen.size)}
            </button>
            <button type="button" className="pill" onClick={() => setAct(null)}>
              {T.common.cancel}
            </button>
          </div>
        )
      }
    >
      {friends.length === 0 ? (
        <p className="hint">{T.common.noFriends}</p>
      ) : (
        <>
          {people.length > 0 &&
            (act ? (
              <div className="batch-head">
                <span>{act === "gift" ? T.friends.pickGift : fmtParts(T.friends.pickWho, { act: BATCH_NAMES[act] })}</span>
                {starred && (
                  <button type="button" className="pill" onClick={onlyStarred}>
                    {T.friends.starredOnly}
                  </button>
                )}
              </div>
            ) : (
              <div className="batch-row">
                <span className="batch-label">{T.friends.batch.label}</span>
                {acts.map((a) => (
                  <button key={a} type="button" className={`pill${a === "gift" ? " gift" : ""}`} disabled={busy} onClick={() => startPick(a)}>
                    {BATCH_NAMES[a]}
                  </button>
                ))}
              </div>
            ))}

          {!act && (
            <>
              {theirs.length > 0 && (
                <section className="help-box">
                  <button type="button" className="help-head" onClick={() => setAskedOpen(!askedOpen)} aria-expanded={askedOpen}>
                    <span>{fmtParts(T.friends.theirs, { n: theirs.length })}</span>
                    <span className="muted">{askedOpen ? T.common.collapse : T.friends.expand}</span>
                  </button>
                  {askedOpen &&
                    theirs.map((r) => (
                      <TheirHelp key={r.id} item={r} busy={busy} onOpen={onOpen} onAnswer={onAnswerHelp} onCopyUid={onCopyUid} />
                    ))}
                </section>
              )}
              {people.length > 0 && (
                <section className="help-box">
                  <div className="help-head static">
                    <span>{fmtParts(T.friends.mine, { count: mine.length ? fmt(T.common.inParens, { text: mine.length }) : "" })}</span>
                    <button type="button" className="pill dark" disabled={busy} onClick={onAskHelp}>
                      {T.help.ask.title}
                    </button>
                  </div>
                  {mine.length === 0 ? (
                    <p className="hint help-hint">{T.friends.helpNote}</p>
                  ) : (
                    mine.map((r) => <MyHelp key={r.id} item={r} busy={busy} onClose={onCloseHelp} />)
                  )}
                </section>
              )}
              <p className="hint">{fmtParts(T.friends.total, { n: friends.length })}</p>
            </>
          )}

          <div className="friend-grid">
            {(act ? people : friends).map((f) => {
              const why = act ? cannot(f, act) : null;
              const on = act ? chosen.has(f.id) : false;
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`friend-tile${act ? " picking" : ""}${on ? " on" : ""}${why ? " off" : ""}`}
                  disabled={Boolean(act && why)}
                  aria-pressed={act ? on : undefined}
                  onClick={() => (act ? flip(f.id) : onOpen(f.id))}
                >
                  {f.star !== null && (
                    <span className="tile-star" aria-label={T.friends.starred}>
                      ★
                    </span>
                  )}
                  {!act && asking.has(f.id) && <span className="tile-help" title={T.friends.asking} />}
                  {act && !why && <span className={`tile-tick${on ? " on" : ""}`} aria-hidden="true" />}
                  <RoachIcon color={f.profile.color} size={60} avatar={f.profile.avatar} friend />
                  <strong>{f.profile.displayName}</strong>
                  <small>{why ?? ago(f.since)}</small>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}
