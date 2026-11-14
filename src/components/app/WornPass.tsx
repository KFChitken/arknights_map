"use client";

import dynamic from "next/dynamic";
import { fmt, T } from "@/i18n";
import { characterName } from "@/i18n/names";
import { padNo, type PassOnCard } from "@/lib/passes";

/**
 * 通行证寻访 on profile cards (我的资料, TA 的资料, 触须之交): the pass worn, small on the right of the card
 * (passes/ProfilePass.tsx, fetched only for a card with one, as most have none), and its line under the card,
 * 「通行证 能天使 No.000007 · 潜能 2」 (潜能 from a second copy). The card's name is printed on it as its holder.
 */
const ProfilePass = dynamic(() => import("./passes/ProfilePass"), {
  ssr: false,
  // its room kept while it comes, so the card does not jump
  loading: () => <span className="who-pass" aria-hidden="true" />,
});

export function WornPassMini({ pass, holder }: { pass: PassOnCard; holder: string }) {
  return <ProfilePass pass={pass} holder={holder} />;
}

export function WornPassLine({ pass }: { pass: PassOnCard }) {
  const t = T.passes.card;
  return (
    <dl className="pf pass-line">
      <div>
        <dt>{t.row}</dt>
        <dd>
          {fmt(t.value, { name: characterName(pass.name), no: padNo(pass.no) })}
          {pass.copies >= 2 && fmt(t.potential, { n: pass.copies })}
        </dd>
      </div>
    </dl>
  );
}
