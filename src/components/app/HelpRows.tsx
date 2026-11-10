"use client";

import { useState } from "react";
import { serverName } from "@/lib/games";
import { HELP_ANSWER, helpAnswerText, helpText } from "@/lib/help";
import type { HelpItem } from "@/lib/world/types";
import RoachIcon from "../RoachIcon";
import { ago } from "./InboxSheet";

/** 「还剩 5 小时」 until a request comes down by itself */
export function leftText(until: number, now = Date.now()) {
  const h = Math.ceil((until - now) / 3_600_000);
  return h <= 1 ? "不到 1 小时后消失" : `还剩 ${h} 小时`;
}

const toggle = (list: number[], n: number) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));

/** What you answered to one of theirs */
function answeredText(item: HelpItem) {
  if (item.kind === "clues") return `你送了 ${(item.answered?.clues ?? []).join("、")} 号`;
  return item.kind === "exchange" ? "你去拜访了" : "你挂上了";
}

/**
 * One of a 触须之交's requests (src/lib/help.ts), with the answer: 送了 (picking which of the
 * clues asked for), 去拜访了 or 我挂上了; their UID for the game when they share it, for adding
 * them there first. who: on the 触须之交 page, who asks; their own page leaves it out.
 */
export function TheirHelp({
  item,
  busy,
  who = true,
  onOpen,
  onAnswer,
  onCopyUid,
}: {
  item: HelpItem;
  busy: boolean;
  who?: boolean;
  onOpen?: (friendId: string) => void;
  onAnswer: (requestId: string, clues?: number[]) => void;
  onCopyUid: (uid: string) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const from = item.from;
  const uid = from?.uid?.[item.game];
  const server = serverName(item.game, from?.uidServer?.[item.game]);
  return (
    <div className={`help-row${item.fresh ? " fresh" : ""}`}>
      {who && from && (
        <button type="button" className="help-who" onClick={() => item.friendId && onOpen?.(item.friendId)}>
          <RoachIcon color={from.color} avatar={from.avatar} size={30} friend />
          <strong>{from.displayName}</strong>
        </button>
      )}
      <div className="help-text">{helpText(item)}</div>
      <div className="help-meta muted">{leftText(item.until)}</div>
      {uid && (
        <div className="help-uid">
          <span>
            UID：{server ? `${server} ` : ""}
            {uid}
          </span>
          <button type="button" className="pill" onClick={() => onCopyUid(uid)}>
            复制
          </button>
        </div>
      )}
      <div className="row-actions">
        {item.answered ? (
          <span className="done">{answeredText(item)}</span>
        ) : item.kind === "clues" ? (
          <>
            {(item.clues ?? []).map((n) => (
              <button key={n} type="button" className={`chip${picked.includes(n) ? " on" : ""}`} onClick={() => setPicked(toggle(picked, n))}>
                {n} 号
              </button>
            ))}
            <button type="button" className="pill dark" disabled={busy || !picked.length} onClick={() => onAnswer(item.id, picked)}>
              {HELP_ANSWER.clues}
            </button>
          </>
        ) : (
          <button type="button" className="pill dark" disabled={busy} onClick={() => onAnswer(item.id)}>
            {HELP_ANSWER[item.kind]}
          </button>
        )}
      </div>
      {item.kind === "clues" && !item.answered && <p className="hint help-hint">点你送了的几号，再点「送了」。</p>}
    </div>
  );
}

/** One of your own requests: who answered what, and 关掉 */
export function MyHelp({ item, busy, onClose }: { item: HelpItem; busy: boolean; onClose: (requestId: string) => void }) {
  const answers = item.answers ?? [];
  return (
    <div className={`help-row mine${item.fresh ? " fresh" : ""}`}>
      <div className="help-text">{helpText(item)}</div>
      <div className="help-meta muted">{leftText(item.until)}</div>
      {answers.length === 0 ? (
        <p className="hint help-hint">还没有人回应。</p>
      ) : (
        answers.map((a) => (
          <div key={a.friendId} className={`help-answer${a.fresh ? " fresh" : ""}`}>
            <span>{helpAnswerText(item, a.name, a.clues)}</span>
            <span className="muted">{ago(a.at)}</span>
          </div>
        ))
      )}
      <div className="row-actions">
        <button type="button" className="pill" disabled={busy} onClick={() => onClose(item.id)}>
          关掉
        </button>
      </div>
    </div>
  );
}
