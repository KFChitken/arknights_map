"use client";

import { useState } from "react";
import { fmtParts } from "@/i18n";
import { BATCH_ACTS, BATCH_NAMES, FRIEND_ACTS_PER_DAY, type BatchAct } from "@/lib/friendly";
import type { Friend, HelpBoard } from "@/lib/world/types";
import { MyHelp, TheirHelp } from "./HelpRows";
import { ago } from "./InboxSheet";
import Sheet from "./Sheet";
import RoachIcon from "../RoachIcon";

/** The 触须之交 mark: two feelers that met, under a heart, as when two roaches become 触须之交 */
export function FriendsMark({ size = 19 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M5 22 C5 15.5 8 12.2 12 12.2 M19 22 C19 15.5 16 12.2 12 12.2" fill="none" stroke="#1b1d22" strokeWidth="2" strokeLinecap="round" />
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
  if (!b) return "向导";
  if (act === "sanity") return b.done.sanity ? "今天催过了" : b.actsLeft <= 0 ? `今天满 ${FRIEND_ACTS_PER_DAY} 次了` : null;
  if (b.asleep) return "睡着了";
  return b.actsLeft <= 0 ? `今天满 ${FRIEND_ACTS_PER_DAY} 次了` : null;
}

/** The send button: 「和 12 位贴贴」 */
function sendLabel(act: BatchAct, n: number) {
  if (act === "luck") return `吸 ${n} 位的欧气`;
  if (act === "sanity") return `催 ${n} 位清理智`;
  return `和 ${n} 位${BATCH_NAMES[act]}`;
}

/**
 * Everyone you are 触须之交 with: 特别关注 first, then the guides, then everyone else, as a grid
 * of how they look on the map; a tap opens one (FriendView), and going back comes here again.
 * On top: 一键 (贴贴 · 击掌 · 吸欧气 · 催理智 for many at once: pick, everyone who can have it
 * ticked), then 求助: your 触须之交's requests and your own (src/lib/help.ts), which never pop up
 * anywhere else.
 */
export default function FriendsSheet({
  friends,
  help,
  busy,
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
  onOpen: (id: string) => void;
  onBatch: (act: BatchAct, friendIds: string[]) => void;
  onAskHelp: () => void;
  onAnswerHelp: (requestId: string, clues?: number[]) => void;
  onCloseHelp: (requestId: string) => void;
  onCopyUid: (uid: string) => void;
  onClose: () => void;
}) {
  const [act, setAct] = useState<BatchAct | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [askedOpen, setAskedOpen] = useState(true);
  const people = friends.filter((f) => f.between);
  const starred = people.some((f) => f.star !== null);
  const asking = new Set((help?.theirs ?? []).map((r) => r.friendId));

  // picking for a 一键: everyone who can have it, ticked
  const startPick = (a: BatchAct) => {
    setAct(a);
    setChosen(new Set(people.filter((f) => !cannot(f, a)).map((f) => f.id)));
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
      title="触须之交"
      onClose={onClose}
      footer={
        act && (
          <div className="batch-bar">
            <button type="button" className="primary" disabled={busy || chosen.size === 0} onClick={() => onBatch(act, [...chosen])}>
              {sendLabel(act, chosen.size)}
            </button>
            <button type="button" className="pill" onClick={() => setAct(null)}>
              取消
            </button>
          </div>
        )
      }
    >
      {friends.length === 0 ? (
        <p className="hint">还没有触须之交。你大胆碰了 TA，TA 也大胆碰了你，你们就会成为触须之交。</p>
      ) : (
        <>
          {people.length > 0 &&
            (act ? (
              <div className="batch-head">
                <span>
                  {fmtParts("选好和谁{act}（能收的都勾上了）", { act: BATCH_NAMES[act] })}
                </span>
                {starred && (
                  <button type="button" className="pill" onClick={onlyStarred}>
                    只选特别关注
                  </button>
                )}
              </div>
            ) : (
              <div className="batch-row">
                <span className="batch-label">一键</span>
                {BATCH_ACTS.map((a) => (
                  <button key={a} type="button" className="pill" disabled={busy} onClick={() => startPick(a)}>
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
                    <span>{fmtParts("大家在求助（{n}）", { n: theirs.length })}</span>
                    <span className="muted">{askedOpen ? "收起" : "展开"}</span>
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
                    <span>{fmtParts("我的求助{count}", { count: mine.length ? `（${mine.length}）` : "" })}</span>
                    <button type="button" className="pill dark" disabled={busy} onClick={onAskHelp}>
                      发求助
                    </button>
                  </div>
                  {mine.length === 0 ? (
                    <p className="hint help-hint">缺线索、想开线索交流、想借助战，都可以问问触须之交。</p>
                  ) : (
                    mine.map((r) => <MyHelp key={r.id} item={r} busy={busy} onClose={onCloseHelp} />)
                  )}
                </section>
              )}
              <p className="hint">{fmtParts("共 {n} 位，点一位看 TA 的资料。", { n: friends.length })}</p>
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
                    <span className="tile-star" aria-label="特别关注">
                      ★
                    </span>
                  )}
                  {!act && asking.has(f.id) && <span className="tile-help" title="在求助" />}
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
