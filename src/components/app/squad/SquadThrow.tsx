"use client";
/* eslint-disable @next/next/no-img-element -- the site's own small pictures (public/fish), shown as they are */

import { useEffect, useState } from "react";
import { fmt, T } from "@/i18n";
import { FISH_ITEMS } from "@/lib/fish/items";
import type { SquadMember } from "@/lib/squad";
import { THROW_EVERY_MS, THROW_GROUPS, THROWS, THROWS_AT_A_MINUTE } from "@/lib/squadFire";
import { WorldError } from "@/lib/world/types";
import { picOf } from "../fish/words";
import { squadThrowAt } from "./squading";
import "./squadFire.css";

/**
 * 扔东西's picker (卫戍碎片时间玩法 ⑤), in a teammate's card in place of what it shows (SquadMateCard.tsx): 扔给 TA, when
 * the next may go (5 s apart, three a minute at TA), the four groups of THROWS with their pictures; a tap throws one,
 * and it lands on TA's tile (SquadRoach.tsx). The rules under it. The server keeps to the same limits; this page only
 * says them ahead.
 */

/** What a parcel thrown at a 人机 may hold (on this page alone), as the server's: 钓鳞's junk that bites somewhere */
const JUNK = FISH_ITEMS.filter((i) => i.cat === "junk" && !i.off && !i.kind).map((i) => i.no);

/** When this page last threw, and at whom in the last minute (by number in the room), for what it says ahead */
let lastAt = 0;
const atWhom = new Map<number, number[]>();
const thrownAt = (h: number, now: number) => (atWhom.get(h) ?? []).filter((t) => now - t < 60_000);

export default function ThrowPicker({ m, onBack }: { m: SquadMember; onBack: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const left = THROWS_AT_A_MINUTE - thrownAt(m.h, now).length;
  const wait = Math.max(0, Math.ceil((lastAt + THROW_EVERY_MS - now) / 1000));
  const status = left <= 0 ? fmt(T.squad.throw.used, { n: THROWS_AT_A_MINUTE }) : wait > 0 ? fmt(T.squad.throw.wait, { s: wait, n: left }) : fmt(T.squad.throw.ready, { n: left });
  const go = async (no: number) => {
    if (busy || wait > 0 || left <= 0) return;
    setBusy(true);
    setPicked(no);
    setMsg(null);
    try {
      await squadThrowAt(m.h, no, JUNK);
      const at = Date.now();
      lastAt = at;
      atWhom.set(m.h, [...thrownAt(m.h, at), at]);
      setNow(at);
    } catch (e) {
      setMsg(e instanceof WorldError ? e.message : T.map.common.tryAgain);
    } finally {
      setBusy(false);
    }
  };
  const words = T.squad.throw.items as Record<string, { name: string; say: string }>;
  return (
    <div className="sq-throw" role="group" aria-label={fmt(T.squad.throw.title, { name: m.name })}>
      <div className="hd">
        <b>{fmt(T.squad.throw.title, { name: m.name })}</b>
        <span className="cool">{status}</span>
      </div>
      {THROW_GROUPS.map((g) => (
        <div key={g} className={`grp g-${g}`}>
          <span className="gn">
            {T.squad.throw.groups[g]}
            {T.squad.throw.groupsNote[g] && <small>{T.squad.throw.groupsNote[g]}</small>}
          </span>
          <span className="its">
            {THROWS.filter((t) => t.group === g).map((t) => (
              <button
                key={t.no}
                type="button"
                className={picked === t.no ? "on" : undefined}
                disabled={busy || wait > 0 || left <= 0}
                onClick={() => void go(t.no)}
              >
                <img src={picOf(t.key)} alt="" />
                <span>{words[t.key]?.name}</span>
              </button>
            ))}
          </span>
        </div>
      ))}
      {msg && (
        <p className="tmsg" role="status">
          {msg}
        </p>
      )}
      <p className="note">{T.squad.throw.note}</p>
      <button type="button" className="ghost back" onClick={onBack}>
        {T.squad.throw.close}
      </button>
    </div>
  );
}
