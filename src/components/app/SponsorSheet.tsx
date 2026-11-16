"use client";

import { useState } from "react";
import { fmt, sentences, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { apiFetch } from "@/lib/apiFetch";
import { BADGES } from "@/lib/badges";
import { MIN_SIGNUP_AGE, siteName } from "@/lib/rules";
import { enough, inHand, monthsCovered, share, whichMonth, yuan, type LedgerRow, type SponsorView } from "@/lib/sponsor";
import type { RoachAvatar, RoachColor } from "@/lib/types";
import { useGrayNow } from "../GrayMode";
import Sheet from "./Sheet";
import { AfdianLink, GiftBadges, SponsorStage } from "./SponsorFx";

/**
 * 支持舟P地图 (src/lib/sponsor.ts): the card in 我的资料, and on /support for anyone. Its buttons are plain
 * links out; nothing of the sponsoring platforms is loaded here.
 */

/** GET /api/sponsor: the card, or null while the entry is off (and on the English site); a failed ask leaves the entry out too */
export async function fetchSponsor(): Promise<SponsorView | null> {
  try {
    const res = await apiFetch("/api/sponsor", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { sponsor?: SponsorView | null }).sponsor ?? null;
  } catch {
    return null;
  }
}

/** Names as the card lists them: 「服务器饲养员」和「?!电电!?」 */
const named = (names: string[]) => names.map((name) => fmt(T.sponsor.badgeName, { name })).join(T.sponsor.and);

/**
 * The thanks a sponsor gets, one line for each kind: the looks only sponsors have, as the server lists them to this
 * player (SponsorView looks: none while none shows to them, so the card never offers a look they cannot see), and
 * the badges
 */
const gifts = (looks: readonly RoachAvatar[]) => [
  ...(looks.length ? [fmt(T.sponsor.giftLooks, { looks: named(looks.map((a) => T.profile.avatar[a])) })] : []),
  fmt(T.sponsor.giftBadges, { badges: named(BADGES.filter((b) => b.sponsor).map((b) => b.name)) }),
];

/** What a sponsor is given, under the copy button, and how it looks: the badges, and 鸭爵 where he is named (calm: while the site is gray) */
function Thanks({ calm, looks }: { calm: boolean; looks: readonly RoachAvatar[] }) {
  const list = gifts(looks);
  return (
    <div className="sponsor-thanks hint">
      <p>{T.sponsor.thanksLead}</p>
      {/* numbered once there is more than one */}
      <ol className={list.length === 1 ? "one" : undefined}>
        {list.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ol>
      <GiftBadges calm={calm} duck={looks.includes("duck")} />
      <p>{T.sponsor.thanksTail}</p>
    </div>
  );
}

/** The clipboard, or the old copy command where an in-app browser has only that; false when neither works */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // tried the other way below
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.top = "0";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    const done = document.execCommand("copy");
    box.remove();
    return done;
  } catch {
    return false;
  }
}

/**
 * 复制我的登录邮箱: the email is not on the card, so a screenshot of it shows none; only where copying is
 * not allowed does it come up, selected, to copy by hand.
 */
function CopyEmail({ email, calm, looks }: { email: string; calm: boolean; looks: readonly RoachAvatar[] }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="sponsor-copy">
      <button className="pill dark" onClick={async () => setCopied(await copyText(email))}>
        {copied ? T.sponsor.copied : T.sponsor.copy}
      </button>
      {copied === false && (
        <>
          <p className="hint">{T.sponsor.copyByHand}</p>
          <input
            type="text"
            className="sponsor-email"
            readOnly
            value={email}
            aria-label={T.sponsor.emailLabel}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      )}
      <Thanks calm={calm} looks={looks} />
    </div>
  );
}

/**
 * This month's bill and what came in so far, as a bar; what the months before left over counts too.
 * months: how many months that keeps the servers going, said once it is two or more.
 */
function Progress({ row, months }: { row: LedgerRow & { current: boolean }; months: number }) {
  const full = enough(row);
  // a sliver shows as soon as anything came in
  const pct = inHand(row) > 0 ? Math.max(3, Math.round(share(row) * 100)) : 0;
  return (
    <div className={`sponsor-progress${full ? " full" : ""}`}>
      <p className="sponsor-sum">
        <span>
          {fmtNodes(row.current ? T.sponsor.receivedNow : T.sponsor.receivedThen, {
            month: whichMonth(row),
            received: <b>{yuan(row.received)}</b>,
            spent: yuan(row.spent),
          })}
        </span>
        {full && <span className="sponsor-done">{months >= 2 ? fmt(T.sponsor.enoughMonths, { n: months }) : T.sponsor.enough}</span>}
      </p>
      <div
        className="sponsor-bar"
        role="progressbar"
        aria-label={fmt(T.sponsor.barLabel, { month: whichMonth(row) })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share(row) * 100)}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {row.carried > 0 && <p className="hint">{fmt(T.sponsor.carried, { sum: yuan(row.carried) })}</p>}
      {row.note && <p className="hint">{fmt(T.sponsor.spentOn, { note: row.note })}</p>}
    </div>
  );
}

/** What the servers cost, as the card asks for help with it: this month's bill, a past month's, or none entered */
function bill(row: (LedgerRow & { current: boolean }) | null) {
  if (!row) return T.sponsor.askBillNone;
  if (row.current) return fmt(T.sponsor.askBillNow, { sum: yuan(row.spent) });
  return fmt(T.sponsor.askBillThen, { month: whichMonth(row), sum: yuan(row.spent) });
}

/**
 * The card: what the servers cost and what came in (「够啦」 once it is paid for, and how many months it
 * keeps them going once that is two or more), the copy button for a signed-in player (a visitor is asked
 * to sign in first), and the way to the sponsoring page; above it all the player's roach throws the server hearts
 * (SponsorFx.tsx), but not while the site is gray (全站变灰), when nothing on it moves.
 * onPage: on /support, where the accounts follow below. color: the player's roach's, cyan as for a new one.
 * grayFirst: whether the site was gray as the page was drawn on the server (/support), for its first look.
 */
export function SponsorCard({
  view,
  onPage = false,
  color = "cyan",
  grayFirst = false,
}: {
  view: SponsorView;
  onPage?: boolean;
  color?: RoachColor;
  grayFirst?: boolean;
}) {
  const calm = useGrayNow(grayFirst);
  const row = view.month && view.month.spent > 0 ? view.month : null;
  const full = row ? enough(row) : false;
  // how long what is in hand keeps the servers going, said only against this month's bill
  const months = row?.current ? monthsCovered(row) : 0;
  const Title = onPage ? "h2" : "h3";
  return (
    <div className="sponsor">
      {!calm && <SponsorStage color={color} full={full} />}
      {full && row && months >= 2 ? (
        <>
          <Title className="sponsor-title">{fmt(T.sponsor.monthsTitle, { n: months })}</Title>
          <p>{fmt(T.sponsor.monthsText, { sum: yuan(row.spent), n: months })}</p>
        </>
      ) : full && row ? (
        <>
          <Title className="sponsor-title">{fmt(T.sponsor.enoughTitle, { month: whichMonth(row) })}</Title>
          <p>{row.repaid > 0 ? T.sponsor.enoughTextStartup : T.sponsor.enoughText}</p>
        </>
      ) : (
        <>
          <Title className="sponsor-title">{fmt(T.sponsor.askTitle, { site: siteName() })}</Title>
          <p>{sentences(fmt(T.sponsor.askIntro, { site: siteName() }), `${T.sponsor.askWhy}${bill(row)}`, T.sponsor.askLiving)}</p>
          <p>{fmt(T.sponsor.askMore, { site: siteName() })}</p>
        </>
      )}

      {row && <Progress row={row} months={months} />}

      {view.email ? <CopyEmail email={view.email} calm={calm} looks={view.looks} /> : <p className="sponsor-signin">{T.sponsor.signIn}</p>}

      <div className="sponsor-go">
        <AfdianLink href={view.afdian} calm={calm} />
        {view.kofi && (
          <a className="sponsor-button alt" href={view.kofi} target="_blank" rel="noreferrer">
            {T.sponsor.kofi}
          </a>
        )}
      </div>

      <ul className="sponsor-notes">
        <li>{fmt(T.sponsor.noteAge, { age: MIN_SIGNUP_AGE })}</li>
        <li>{view.repaying ? T.sponsor.noteEnoughStartup : T.sponsor.noteEnough}</li>
        <li>{T.sponsor.noteRefund}</li>
        <li>{fmt(T.sponsor.noteUnofficial, { site: siteName() })}</li>
      </ul>

      {!onPage && (
        <a className="sponsor-ledger" href="/support" target="_blank" rel="noreferrer">
          {T.sponsor.ledger}
        </a>
      )}
    </div>
  );
}

/** 支持舟P地图, opened from 我的资料 and going back to it (onBack), or from its button on the map; color: the player's roach's */
export default function SponsorSheet({
  view,
  color,
  onBack,
  onClose,
}: {
  view: SponsorView;
  color: RoachColor;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={fmt(T.sponsor.title, { site: siteName() })} onBack={onBack} onClose={onClose}>
      <SponsorCard view={view} color={color} />
    </Sheet>
  );
}
