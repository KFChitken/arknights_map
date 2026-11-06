"use client";

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

/** One line about what is new on the site, for players coming back; "" when there is nothing to tell. */
export const WHATS_NEW = "新功能：佩丽卡监督来了，她就在你的本体附近。";

const NEXT: Record<BadgeCount, (more: number, name: string) => string> = {
  friends: (n, name) => `再交 ${n} 位触须之交，你就是${name}了。`,
  responders: (n, name) => `再有 ${n} 位舟P回应你的宣言，你就是${name}了。`,
  // never picked by nextBadge, which leaves drinking alone
  drinks: (n, name) => `再摄入 ${n} 次酒精，你就是${name}了。`,
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
    pokers ? `${pokers} 趁你睡着戳了戳你` : "",
    touches.length ? `被碰了 ${touches.length} 次${bold ? `，其中 ${bold} 次是大胆碰` : ""}` : "",
    friends ? `新增 ${friends} 位触须之交` : "",
    reactions ? `你的宣言收到 ${reactions} 个回应` : "",
  ].filter(Boolean);
  const quiet = !happened.length && !homecoming.arrivals;
  // 石棺里的苏醒, given on coming back after a long time away
  const awoke = me.badges.find((b) => b.id === "survivor" && !b.seen);
  const next = nextBadge(me.badges, me.counts);
  return (
    <Sheet
      // only those who play just Endfield are 管理员
      title={amiya ? amiyaLine("greet", me.profile.games) : `欢迎回家，${WELCOME_NAMES[homeGame(me.profile.games)]}`}
      onClose={onClose}
      footer={
        quiet ? (
          <button className="primary wide" onClick={onWelcome}>
            发一条「欢迎回家」
          </button>
        ) : unseen.length ? (
          <button className="primary wide" onClick={onInbox}>
            去看看
          </button>
        ) : (
          <button className="primary wide" onClick={onClose}>
            好的
          </button>
        )
      }
    >
      {amiya && (
        <>
          <div className="amiya-greet small">
            <AmiyaPicture size={64} />
            <p>阿米娅向导碰了碰你</p>
          </div>
          <AmiyaTouchBack onTouchBack={amiya.onTouchBack} />
        </>
      )}
      {perlica && (
        <div className="perlica-said" style={amiya ? undefined : { marginTop: 0 }}>
          <PerlicaPicture size={40} />
          <p>
            {PERLICA_NAME}：「{perlica}」
          </p>
        </div>
      )}
      {me.wokeFromAway && (
        <p style={{ marginTop: amiya || perlica ? undefined : 0 }}>你睡了 {homecoming.daysAway} 天，理智早就回满了。</p>
      )}
      {awoke && (
        <p className="homecoming-got">
          拿到了 <BadgePill badge={awoke} />
        </p>
      )}
      {happened.length > 0 && (
        <>
          <p style={{ marginTop: me.wokeFromAway || awoke || amiya || perlica ? undefined : 0 }}>你不在的这几天：</p>
          <ul className="homecoming-list">
            {happened.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </>
      )}
      {homecoming.arrivals > 0 && (
        <p style={happened.length || amiya || perlica ? undefined : { marginTop: 0 }}>
          附近 {RADAR_RADIUS_KM} 公里新来了 {homecoming.arrivals} 只蟑螂。
        </p>
      )}
      {quiet && (
        <p style={amiya || perlica ? undefined : { marginTop: 0 }}>附近静悄悄的。发一条「欢迎回家」宣言，让附近的舟P知道你回来了。</p>
      )}
      {next && <p className="homecoming-next">{NEXT[next.count](next.more, next.name)}</p>}
      {WHATS_NEW && <p className="homecoming-new">{WHATS_NEW}</p>}
    </Sheet>
  );
}
