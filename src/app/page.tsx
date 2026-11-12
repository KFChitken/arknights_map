import { headers } from "next/headers";
import { preconnect } from "react-dom";
import GrayMode from "@/components/GrayMode";
import MapApp from "@/components/MapApp";
import { countAmapLoad } from "@/lib/server/amapLoads";
import { isProd, MAIL_SLOW_DAILY_LIMIT, MAIL_SLOW_DOMAINS } from "@/lib/server/env";
import { ipFrom } from "@/lib/server/http";
import { noticeList } from "@/lib/server/notices";
import { inMainland } from "@/lib/server/region";
import { grayUntil } from "@/lib/server/siteSettings";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The map. Visitors from mainland China get Amap (and our own map abroad), told from
 * their address here and never stored. In development, /?mainland=1 pretends to be one.
 */
export default async function Home({ searchParams }: { searchParams: Search }) {
  const pretend = !isProd && (await searchParams).mainland === "1";
  const cn = pretend || inMainland(ipFrom(await headers()));
  // Mainland visitors load Amap's map code next: its connection opens while our page is still downloading
  if (cn) preconnect("https://webapi.amap.com");
  // and make one of 高德's map loads, counted for the site's checks (nothing about the visitor)
  if (cn) countAmapLoad();
  // mail services no sign-in code goes to just now (MAIL_SLOW_DAILY_LIMIT below 1), for the sign-in sheet to say so
  const mailPaused = MAIL_SLOW_DAILY_LIMIT < 1 ? MAIL_SLOW_DOMAINS : [];
  // 公告, from memory, with the page: the board and the notice that pops up need no ask of their own
  const { stamp, notices } = noticeList(Date.now());
  return (
    <>
      {/* 全站变灰, from memory too: gray from the first look */}
      <GrayMode until={grayUntil(Date.now())} />
      <MapApp cn={cn} mailPaused={mailPaused} notices={{ stamp, notices }} />
    </>
  );
}
