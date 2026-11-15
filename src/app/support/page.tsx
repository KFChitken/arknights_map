import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import GrayMode from "@/components/GrayMode";
import { SponsorCard } from "@/components/app/SponsorSheet";
import { fmt, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { siteName } from "@/lib/rules";
import { monthCell, yuan } from "@/lib/sponsor";
import { ROACH_COLORS } from "@/lib/types";
import { currentUser } from "@/lib/server/auth";
import { grayUntil } from "@/lib/server/siteSettings";
import { sponsorLedger } from "@/lib/server/sponsor";

/**
 * /support: 支持舟P地图's card for anyone, to pass round as a link, what starting the site cost (when the
 * owner gave it) and how much of it the months have paid back, and every month's accounts. Not there at all
 * while the owner has the entry off, or to anyone SPONSOR does not show it to (src/lib/server/env.ts). The copy
 * button is only for a signed-in player. Only in Chinese, as the English site has no entry for now.
 */

export const dynamic = "force-dynamic";
export const generateMetadata = (): Metadata => ({ title: fmt(T.server.support.metaTitle, { site: siteName() }), robots: { index: false } });

export default async function Support() {
  const user = await currentUser();
  const ledger = await sponsorLedger(user);
  if (!ledger) notFound();
  const t = T.server.support;
  const startup = ledger.startup;
  const gray = grayUntil(Date.now());
  return (
    <main className="doc support">
      <GrayMode until={gray} />
      <h1>{fmt(t.title, { site: siteName() })}</h1>
      <SponsorCard
        view={{ ...ledger.card, email: user?.email ?? null }}
        onPage
        color={ROACH_COLORS.find((c) => c === user?.color)}
        grayFirst={gray !== null}
      />

      {startup && (
        <>
          <h2>{t.startupTitle}</h2>
          <p>
            {fmtNodes(startup.note ? t.startupWithNote : t.startup, {
              sum: <b>{yuan(startup.spent)}</b>,
              note: startup.note,
            })}
          </p>
          {startup.repaid > 0 && (
            <p>
              {startup.repaid >= startup.spent
                ? t.startupRepaidAll
                : fmt(t.startupRepaid, { repaid: yuan(startup.repaid), left: yuan(startup.spent - startup.repaid) })}
            </p>
          )}
          <p className="hint">{t.startupHint}</p>
        </>
      )}

      <h2>{t.monthsTitle}</h2>
      {ledger.months.length === 0 ? (
        <p className="hint">{t.noMonths}</p>
      ) : (
        <div className="sponsor-ledger-table">
          <table>
            <thead>
              <tr>
                <th>{t.month}</th>
                <th>{t.spent}</th>
                <th>{t.received}</th>
                <th>{t.balance}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.months.map((m) => (
                <tr key={m.month}>
                  <td>
                    {monthCell(m.month)}
                    {m.note && <small>{m.note}</small>}
                  </td>
                  <td>{yuan(m.spent)}</td>
                  <td>{yuan(m.received)}</td>
                  <td className={m.balance < 0 ? "short" : undefined}>
                    {yuan(m.balance)}
                    {m.repaid > 0 && <small className="repaid">{fmt(t.repaid, { sum: yuan(m.repaid) })}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">{startup ? t.monthsHintStartup : t.monthsHint}</p>

      <p className="hint">
        <Link href="/">{t.back}</Link>
      </p>
    </main>
  );
}
