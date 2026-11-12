"use client";

import { fmt, fmtParts, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { amiyaLine } from "@/lib/amiya";
import { nextBadge, type BadgeCount } from "@/lib/badges";
import { homeGame } from "@/lib/games";
import { AmiyaPicture, AmiyaTouchBack } from "./Amiya";
import { PerlicaPicture } from "./Perlica";
import { BadgePill } from "./Badges";
import { pokedBy } from "./InboxSheet";
import { WELCOME_NAMES } from "@/lib/declarations";
import { PERLICA_NAME } from "@/lib/perlica";
import { RADAR_RADIUS_KM } from "@/lib/rules";
import type { Homecoming, InboxItem, Me } from "@/lib/world/types";
import Sheet from "./Sheet";

const NEXT: Record<BadgeCount, (more: number, name: string) => string> = {
  friends: (n, name) => fmt(T.homecoming.next.friends, { n, name }),
  responders: (n, name) => fmt(T.homecoming.next.responders, { n, name }),
  declareDays: (n, name) => fmt(T.homecoming.next.declareDays, { n, name }),
  reactDays: (n, name) => fmt(T.homecoming.next.reactDays, { n, name }),
  // never picked by nextBadge, which leaves drinking, the sentences and the guides alone
  drinks: (n, name) => fmt(T.homecoming.next.drinks, { n, name }),
  declareLines: (n, name) => fmt(T.homecoming.next.declareLines, { n, name }),
  amiyaDays: (n, name) => fmt(T.homecoming.next.amiyaDays, { n, name }),
  perlicaDays: (n, name) => fmt(T.homecoming.next.perlicaDays, { n, name }),
  guideFriends: (n, name) => fmt(T.homecoming.next.guideFriends, { n, name }),
};

/**
 * 欢迎回家: for a player back after at least a whole day away. Numbers only,
 * all their own: what is unread in their inbox, and who moved in nearby. The one
 * exception is who poked their sleeping roach: 触须之交, whose names they know.
 * On a day 阿米娅向导 greets them too, hers is the welcome, on this one card;
 * 佩丽卡监督's word on how long they were gone comes here too, under hers.
 */
export function HomecomingSheet({
  me,
  homecoming,
  items,
  amiya,
  perlica,
  onInbox,
  onWelcome,
  onClose,
}: {
  me: Me;
  homecoming: Homecoming;
  items: InboxItem[];
  /** 阿米娅向导's greeting of the day, to touch back from here */
  amiya?: { onTouchBack: (bold: boolean) => Promise<string | null> };
  /** 佩丽卡监督's report of how long they were away, word for word */
  perlica?: string;
  onInbox: () => void;
  onWelcome: () => void;
  onClose: () => void;
}) {
  const unseen = items.filter((i) => !i.seen);
  const touches = unseen.filter((i) => i.kind === "touch");
  const bold = touches.filter((i) => i.kind === "touch" && i.bold).length;
  const friends = unseen.filter((i) => i.kind === "friend").length;
  const reactions = unseen.filter((i) => i.kind === "reaction").length;
  const pokers = pokedBy(unseen);
  const happened = [
    pokers ? fmt(T.homecoming.poked, { who: pokers }) : "",
    touches.length ? fmt(T.homecoming.touched, { n: touches.length, bold: bold ? fmt(T.homecoming.touchedBold, { n: bold }) : "" }) : "",
    friends ? fmt(T.homecoming.newFriends, { n: friends }) : "",
    reactions ? fmt(T.homecoming.reactions, { n: reactions }) : "",
  ].filter(Boolean);
  const quiet = !happened.length && !homecoming.arrivals;
  // 石棺里的苏醒, given on coming back after a long time away
  const awoke = me.badges.find((b) => b.id === "survivor" && !b.seen);
  const next = nextBadge(me.badges, me.counts);
  return (
    <Sheet
      // only those who play just Endfield are 管理员
      title={amiya ? amiyaLine("greet", me.profile.games) : fmt(T.declare.line.welcome, { title: WELCOME_NAMES[homeGame(me.profile.games)] })}
      onClose={onClose}
      footer={
        quiet ? (
          <button className="primary wide" onClick={onWelcome}>
            {T.homecoming.sendWelcome}
          </button>
        ) : unseen.length ? (
          <button className="primary wide" onClick={onInbox}>
            {T.common.goSee}
          </button>
        ) : (
          <button className="primary wide" onClick={onClose}>
            {T.common.ok}
          </button>
        )
      }
    >
      {amiya && (
        <>
          <div className="amiya-greet small">
            <AmiyaPicture size={64} />
            <p>{T.guides.amiya.touchedYou}</p>
          </div>
          <AmiyaTouchBack onTouchBack={amiya.onTouchBack} />
        </>
      )}
      {perlica && (
        <div className="perlica-said" style={amiya ? undefined : { marginTop: 0 }}>
          <PerlicaPicture size={40} />
          <p>
            {fmtParts(T.map.guides.saysQuoted, { name: PERLICA_NAME, line: perlica })}
          </p>
        </div>
      )}
      {me.wokeFromAway && (
        <p style={{ marginTop: amiya || perlica ? undefined : 0 }}>{fmtParts(T.homecoming.slept, { days: homecoming.daysAway })}</p>
      )}
      {awoke && (
        <p className="homecoming-got">
          {fmtNodes(T.homecoming.got, { badge: <BadgePill badge={awoke} /> })}
        </p>
      )}
      {happened.length > 0 && (
        <>
          <p style={{ marginTop: me.wokeFromAway || awoke || amiya || perlica ? undefined : 0 }}>{T.homecoming.whileAway}</p>
          <ul className="homecoming-list">
            {happened.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </>
      )}
      {homecoming.arrivals > 0 && (
        <p style={happened.length || amiya || perlica ? undefined : { marginTop: 0 }}>
          {fmtParts(T.homecoming.arrivals, { km: RADAR_RADIUS_KM, n: homecoming.arrivals })}
        </p>
      )}
      {quiet && (
        <p style={amiya || perlica ? undefined : { marginTop: 0 }}>{T.homecoming.quiet}</p>
      )}
      {next && <p className="homecoming-next">{NEXT[next.count](next.more, next.name)}</p>}
      {T.homecoming.whatsNew && <p className="homecoming-new">{T.homecoming.whatsNew}</p>}
    </Sheet>
  );
}
