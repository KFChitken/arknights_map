"use client";

import type { ReactNode } from "react";
import { fmt, T } from "@/i18n";
import { badgeById } from "@/lib/badges";
import { passChar } from "@/lib/passCatalog";
import { padNo } from "@/lib/passes";
import { dayStart, type RecordCat, type RecordWho, type TimelineItem } from "@/lib/records";

/** Each kind of record's colour, the colour on it, and its icon (24×24, stroked) */
export const CAT: Record<RecordCat, { bg: string; fg: string; path: string }> = {
  touch: { bg: "#ffd23f", fg: "#1b1d22", path: "M4 20C6 13 9 10 12 9M20 20C18 13 15 10 12 9M12 9a2.2 2.2 0 1 0 0-.01" },
  declare: { bg: "#ff9f43", fg: "#ffffff", path: "M4 10v4h3l7 4V6L7 10H4zM17 9.5c1.2 1.4 1.2 3.6 0 5" },
  friend: { bg: "#ff7eb6", fg: "#ffffff", path: "M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z" },
  drink: { bg: "#b48cff", fg: "#ffffff", path: "M6.5 4h11L16 11.5a4 4 0 0 1-8 0L6.5 4zM12 15.5V20M8.5 20h7" },
  guide: { bg: "#3fd0d4", fg: "#0b3b3c", path: "M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.5l-5.1 2.7 1-5.7-4.1-4 5.7-.8z" },
  roach: { bg: "#5be37d", fg: "#0f3d1c", path: "M12 20.5s-6-5.6-6-10.5a6 6 0 0 1 12 0c0 4.9-6 10.5-6 10.5zM12 11.6a1.8 1.8 0 1 0 0-.01" },
  harvest: { bg: "#2b3d8f", fg: "#ffe48a", path: "M8 3.5h8l-2.2 6h-3.6zM12 20.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" },
};

export function CatIcon({ cat, size = 22 }: { cat: RecordCat; size?: number }) {
  const c = CAT[cat];
  return (
    <span className="rec-ic" style={{ background: c.bg, color: c.fg, width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={c.path} />
      </svg>
    </span>
  );
}

/** The device's offset, minutes east of UTC, as the server is told it */
export const deviceOffset = () => -new Date().getTimezoneOffset();

/** A moment's date and time on the device's clock, from the parts of a Date read as UTC */
const onClock = (at: number, offset: number) => new Date(at + offset * 60_000);
const pad = (n: number) => String(n).padStart(2, "0");

/** 「08:05」 on the device's clock */
export const clockOf = (at: number, offset: number) => {
  const d = onClock(at, offset);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

/** 「11 月 16 日 周一」, with 今天 or 昨天 before it */
export function dayLabel(day: number, today: number, offset: number) {
  const d = onClock(dayStart(day, offset), offset);
  const label = fmt(T.records.day, { m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: T.records.weekdays[d.getUTCDay()] });
  if (day === today) return fmt(T.records.today, { day: label });
  if (day === today - 1) return fmt(T.records.yesterday, { day: label });
  return label;
}

/** 「11 月 16 日」 */
export function dateOf(at: number, offset: number) {
  const d = onClock(at, offset);
  return fmt(T.records.date, { m: d.getUTCMonth() + 1, d: d.getUTCDate() });
}

/** 本体, 克隆体 2 */
export const slotName = (slot: number | null) =>
  slot === null || slot < 0 ? T.records.slot.roach : slot === 0 ? T.records.slot.main : fmt(T.records.slot.clone, { n: slot });

/** Someone in a record, as named there: 「一位舟P」 once 触须之交 no more, else the fallback when nobody can tell */
export const whoOf = (who: RecordWho, nobody: string) => (who === null ? nobody : "ex" in who ? T.records.timeline.who.ex : who.name);

/**
 * A sentence with someone in it: a name keeps the spaces the sentence has around it, 「一只蟑螂」 and 「一位舟P」 do
 * without, as Chinese is written
 */
export function withWho(text: string, who: RecordWho, nobody: string, more: Record<string, string | number> = {}) {
  if (who && "name" in who) return fmt(text, { ...more, who: who.name });
  return fmt(text, { ...more, who: "\u0000" }).replace(/ ?\u0000 ?/, whoOf(who, nobody));
}

/** 10 公里内有 5–10 只舟P收到 */
export function reachText(n: number) {
  const r = T.records.timeline.reach;
  if (n === 0) return r.none;
  if (n < 5) return r.few;
  for (const [lo, hi] of [
    [5, 10],
    [10, 20],
    [20, 50],
  ]) {
    if (n < hi) return fmt(r.some, { lo, hi });
  }
  return r.many;
}

const GUIDE_NAMES: Record<string, () => string> = {
  amiya: () => T.records.timeline.guides.amiya,
  perlica: () => T.records.timeline.guides.perlica,
  talulah: () => T.records.timeline.guides.talulah,
  minghe: () => T.records.timeline.guides.minghe,
  si: () => T.records.timeline.guides.si,
};

/** An item's line */
export function itemText(i: TimelineItem): string {
  const t = T.records.timeline;
  switch (i.kind) {
    case "tout": {
      const nobody = i.reply ? t.who.roach : i.clone ? t.who.clone : t.who.roach;
      if (i.reply) return withWho(i.bold ? t.tout.boldBack : t.tout.sneakyBack, i.who, nobody);
      return withWho(i.bold ? t.tout.bold : t.tout.sneaky, i.who, nobody);
    }
    case "tin": {
      if (!i.bold) return i.back ? t.tin.sneakyBack : fmt(t.tin.sneaky, { slot: slotName(i.slot) });
      return i.back ? withWho(t.tin.boldBack, i.who, t.who.someone) : withWho(t.tin.bold, i.who, t.who.someone, { slot: slotName(i.slot) });
    }
    case "decl":
      return fmt(t.decl, { text: i.text });
    case "rxin":
      return fmt(t.rxin, { text: i.text, n: i.rx.reduce((a, [, n]) => a + n, 0) });
    case "rxout":
      return fmt(t.rxout, { text: i.text });
    case "friend":
      return withWho(t.friend, i.who, t.who.ex);
    case "note": {
      const out = t.note.out as Record<string, string>;
      if (i.dir === "out") return out[i.note] ? withWho(out[i.note], i.who, t.who.ex) : "";
      const inn = t.note.in as Record<string, string>;
      const theirs = T.lib.friendly.text as Record<string, string>;
      const said = inn[i.note] ?? theirs[i.note];
      return said ? withWho(said, i.who, t.who.ex) : "";
    }
    case "poke":
      return withWho(i.dir === "out" ? t.poke.out : t.poke.in, i.who, t.who.ex);
    case "guide": {
      const guide = GUIDE_NAMES[i.guide]?.() ?? i.guide;
      if (i.dir === "out") return fmt(i.bold ? t.guide.out.bold : t.guide.out.sneaky, { guide });
      return fmt(i.what === "greet" ? t.guide.greet : t.guide.in, { guide });
    }
    case "drink":
      return t.drink;
    case "move": {
      const slot = slotName(i.slot);
      if (i.how === "put") return fmt(t.move.put, { slot });
      if (i.how === "remove") return fmt(t.move.remove, { slot });
      return i.km ? fmt(t.move.move, { slot, km: i.km }) : fmt(t.move.moveNear, { slot });
    }
    case "badge":
      return fmt(t.badge, { name: badgeById(i.badge)?.name ?? i.badge });
    case "ink":
      return fmt(t.ink, { no: i.no });
    case "pass":
      return i.cards.length === 10 ? t.pass.ten : i.cards.length === 1 ? t.pass.single : fmt(t.pass.n, { n: i.cards.length });
  }
}

/** The small line under it, if any */
export function itemSub(i: TimelineItem, offset: number): string {
  const t = T.records.timeline;
  switch (i.kind) {
    case "tout":
      return i.got === "bold" ? t.tout.gotBold : i.got === "sneaky" ? t.tout.gotSneaky : "";
    case "tin":
      return i.mine === "bold" ? t.tin.mineBold : i.mine === "sneaky" ? t.tin.mineSneaky : i.mine === "ignored" ? t.tin.mineIgnored : "";
    case "decl": {
      const n = i.rx.reduce((a, [, k]) => a + k, 0);
      return n ? `${reachText(i.recipients)} · ${fmt(t.rxCount, { n })}` : reachText(i.recipients);
    }
    case "rxin":
      return i.rx
        .slice(0, 2)
        .map(([w, n]) => (n > 1 ? `${w} ×${n}` : w))
        .join(T.records.pause);
    case "rxout":
      return i.reaction ? fmt(t.rxoutSub, { reaction: i.reaction }) : "";
    case "friend":
      return i.who && "ex" in i.who ? t.friendEx : t.friendSub;
    case "note":
      return i.answer === "back" && i.note === "gift" ? t.note.returned : "";
    case "drink": {
      if (i.soberAt === null) return fmt(t.drinkUntil, { time: clockOf(i.until, offset) });
      const mins = Math.round((i.soberAt - i.at) / 60_000);
      return mins < 60 ? fmt(t.drinkSoon, { n: Math.max(1, mins) }) : fmt(t.drinkSober, { time: clockOf(i.soberAt, offset) });
    }
    case "pass": {
      const wished = [...new Set(i.cards.filter((c) => c.wish).map((c) => passChar(c.charId)?.name ?? ""))].filter(Boolean);
      const fresh = i.cards.filter((c) => c.tag === "new").length;
      const gold = i.cards.filter((c) => c.gold).length;
      return [
        wished.length ? fmt(t.passSum.wish, { names: wished.join(T.records.pause) }) : "",
        fresh ? fmt(t.passSum.new, { n: fresh }) : "",
        gold ? fmt(t.passSum.gold, { n: gold }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    }
    default:
      return "";
  }
}

/** What opens under it, if anything */
export function itemDetail(i: TimelineItem, offset: number): ReactNode | null {
  const t = T.records.timeline;
  switch (i.kind) {
    case "tout":
      return i.reply ? t.tout.detailBack : i.bold ? t.tout.detailBold : t.tout.detailSneaky;
    case "tin":
      return `${fmt(t.tin.detail, { slot: slotName(i.slot) })}${i.bold ? t.tin.detailBold : t.tin.detailSneaky}`;
    case "decl":
      return (
        <>
          {i.roaches ? fmt(t.fromRoaches, { n: i.roaches }) : ""}
          {i.drunk ? t.drunkLine : ""}
          {fmt(t.reachLine, { reach: reachText(i.recipients) })}
          {i.rx.length ? (
            <>
              <div className="rx">
                {i.rx.map(([w, n]) => (
                  <span key={w}>{n > 1 ? `${w} ×${n}` : w}</span>
                ))}
              </div>
              <div style={{ marginTop: 4 }}>{t.rxWho}</div>
            </>
          ) : (
            <div>{t.noRx}</div>
          )}
        </>
      );
    case "rxin":
      return fmt(t.rxinDetail, { day: dateOf(i.declaredAt, offset), time: clockOf(i.declaredAt, offset) });
    case "drink":
      return t.drinkDetail;
    case "note":
      return i.note === "gift" ? t.note.giftDetail : null;
    case "pass":
      return (
        <>
          <div className="rec-cards-list">
            {i.cards.map((c, k) => (
              <span key={k}>
                {passChar(c.charId)?.name ?? ""} <small>No.{padNo(c.no)}</small>
                {c.wish && <em className="w">{t.passWish}</em>}
                <em>{t.passTags[c.tag]}</em>
                {c.gold && <em className="g">{t.passGold[c.gold as "top" | "lucky"] ?? ""}</em>}
              </span>
            ))}
          </div>
          <div style={{ marginTop: 6 }}>{t.passDetail}</div>
        </>
      );
    default:
      return null;
  }
}
