"use client";

import { useState, type CSSProperties } from "react";
import { fmt, T } from "@/i18n";
import { TO, type SquadMember, type SquadRoom } from "@/lib/squad";
import { SquadRoach } from "./SquadRoach";
import { closeSquadToMe, lineWords, sayInSquad, useSquadToMe, type SquadToMe as ToMe } from "./squading";
import "./squadBar.css";

/**
 * A line said to you in the room (对 TA 说): who said it and the line, dark as a 宣言's, with its answers under it
 * (好，我换 · 不换啦，你换一个？ to 能换个策略吗？ and 能把「…」让给我吗？, 好嘞 to 选个策略吧 and 快准备呀, none to
 * 谢谢！, which goes by itself). An answer is said to TA in turn, and 好，我换 (and 好嘞 to 选个策略吧) goes on to the
 * room's strategy picker. Over the room's sheet, or over 卫戍中 on the map while the sheet is shut; gone at its ×, a
 * newer one, an answer, or the round starting.
 */

/** The answers to a line said to you, by its number */
export const answersTo = (p: number): number[] => (p === TO.change || p === TO.giveUp ? [TO.ok, TO.no] : p === TO.pick || p === TO.ready ? [TO.sure] : []);

/** Whether answering goes on to the strategy picker */
export const answerPicks = (asked: number, answer: number) => answer === TO.ok || (asked === TO.pick && answer === TO.sure);

/** The banner as it shows, for the line said, by whom */
export function ToMeCard({
  line,
  from,
  busy,
  note,
  className,
  style,
  onAnswer,
  onClose,
}: {
  line: Pick<ToMe, "p" | "s">;
  from: SquadMember;
  busy: boolean;
  /** Why an answer did not go (said too fast, the hour's used up) */
  note?: string | null;
  className?: string;
  style?: CSSProperties;
  onAnswer: (p: number) => void;
  onClose: () => void;
}) {
  const answers = answersTo(line.p);
  return (
    <div className={`sq-tome${className ? ` ${className}` : ""}`} style={style} role="alert">
      <span className="ri" aria-hidden="true">
        <SquadRoach m={from} size={36} />
      </span>
      <div className="tx">
        <small>{fmt(T.squad.say.toMe, { name: from.name })}</small>
        <b>{lineWords(line.p, line.s)}</b>
      </div>
      {answers.length > 0 && (
        <div className="acts">
          {answers.map((a, i) => (
            <button key={a} type="button" className={i === 0 ? "acc" : undefined} disabled={busy} onClick={() => onAnswer(a)}>
              {T.squad.say.lines[a - 1]}
            </button>
          ))}
        </div>
      )}
      {note && <p className="note">{note}</p>}
      <button type="button" className="x" aria-label={T.squad.say.toMeClose} onClick={onClose}>
        ×
      </button>
    </div>
  );
}

/** The line said to you now, in this room, while it waits; onPick: open the strategy picker. An answer refused says why in it */
export default function SquadToMe({ room, className, style, onPick }: { room: SquadRoom; className?: string; style?: CSSProperties; onPick: () => void }) {
  const toMe = useSquadToMe();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ key: number; text: string } | null>(null);
  const from = toMe ? room.members.find((m) => m.h === toMe.h && !m.you) : undefined;
  if (!toMe || !from || room.state === "go") return null;
  const answer = async (p: number) => {
    setBusy(true);
    try {
      const res = await sayInSquad(p, from.h);
      if (!res.sent) return setNote({ key: toMe.key, text: res.full ? T.squad.say.enough : T.squad.say.slow });
      if (answerPicks(toMe.p, p)) onPick();
    } catch (e) {
      setNote({ key: toMe.key, text: e instanceof Error && e.message ? e.message : T.requests.serverTrouble });
    } finally {
      setBusy(false);
    }
  };
  return (
    <ToMeCard
      key={toMe.key}
      line={toMe}
      from={from}
      busy={busy}
      note={note?.key === toMe.key ? note.text : null}
      className={className}
      style={style}
      onAnswer={(p) => void answer(p)}
      onClose={closeSquadToMe}
    />
  );
}
