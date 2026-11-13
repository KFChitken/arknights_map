import { headers } from "next/headers";
import { preconnect } from "react-dom";
import GrayMode from "@/components/GrayMode";
import MapApp from "@/components/MapApp";
import { countAmapLoad } from "@/lib/server/amapLoads";
import { isProd, MAIL_SLOW_DAILY_LIMIT, MAIL_SLOW_DOMAINS, UI_CHOICE } from "@/lib/server/env";
import { ipFrom } from "@/lib/server/http";
import { mainlandMap } from "@/lib/server/mainlandMap";
import { noticeList } from "@/lib/server/notices";
import { inMainland } from "@/lib/server/region";
import { grayUntil } from "@/lib/server/siteSettings";
import { earlyUiScript } from "@/lib/uiChoice";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The map. Visitors from mainland China get Amap (and our own map abroad), told from
 * their address here and never stored: Tencent's map in its place for the rest of a month
 * in which Amap's map loads ran out (src/lib/server/mainlandMap.ts). In development,
 * /?mainland=1 pretends to be one.
 */
export default async function Home({ searchParams }: { searchParams: Search }) {
  const pretend = !isProd && (await searchParams).mainland === "1";
  const cn = pretend || inMainland(ipFrom(await headers()));
  // the map they start with, from memory: 高德's, or 腾讯's once 高德's map loads ran out this month
  const home = cn ? mainlandMap() : "amap";
  // Mainland visitors load that map's code next: its connection opens while our page is still downloading
  if (cn && home === "amap") preconnect("https://webapi.amap.com");
  if (cn && home === "tencent") preconnect("https://map.qq.com");
  // and 高德's makes one of its map loads, counted for the site's checks (nothing about the visitor)
  if (cn && home === "amap") countAmapLoad();
  // mail services no sign-in code goes to just now (MAIL_SLOW_DAILY_LIMIT below 1), for the sign-in sheet to say so
  const mailPaused = MAIL_SLOW_DAILY_LIMIT < 1 ? MAIL_SLOW_DOMAINS : [];
  // 公告, from memory, with the page: the board and the notice that pops up need no ask of their own
  const { stamp, notices } = noticeList(Date.now());
  return (
    <>
      {/* 全站变灰, from memory too: gray from the first look */}
      <GrayMode until={grayUntil(Date.now())} />
      {/* a layout other than 浮岛 picked on this device: 浮岛's buttons stay out of sight until the app draws its own */}
      <script dangerouslySetInnerHTML={{ __html: earlyUiScript(UI_CHOICE) }} />
      <MapApp cn={cn} home={home} mailPaused={mailPaused} notices={{ stamp, notices }} uiChoice={UI_CHOICE} />
    </>
  );
}
