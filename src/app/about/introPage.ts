import type { Lang } from "@/i18n/core";
import { en } from "@/i18n/en";
import { englishOn } from "@/i18n/server";
import { zh } from "@/i18n/zh";
import { earnableCount } from "@/lib/badges";
import { GRAY_CSS } from "@/lib/grayMode";
import { HELP_HOURS } from "@/lib/help";
import { DECLARATION_DAYS, DECLARATION_RADIUS_KM, KEEP_ACTIVITY_DAYS, MAX_CLONES, MIN_SIGNUP_AGE, RADAR_RADIUS_KM } from "@/lib/rules";
import { haimaoMode, studyMode } from "@/lib/server/env";
import { playersOnMapNow } from "@/lib/server/roachFeed";
import { grayUntil } from "@/lib/server/siteSettings";
import { INTRO_TEMPLATE } from "./introTemplate";
import { INTRO_TEMPLATE_ZH } from "./introTemplateZh";

/**
 * The intro pages, /about in English (./route.ts) and /about/zh in Chinese (./zh/route.ts), from their templates
 * (./introTemplate.ts, ./introTemplateZh.ts): the blanks filled from the code, made once for each of the ways a page
 * can be (the English site on or off, the whole site gray or not) and kept, with the number of players on the map
 * put in for each visit.
 */

const TEMPLATES: Record<Lang, string> = { en: INTRO_TEMPLATE, zh: INTRO_TEMPLATE_ZH };

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Text for HTML, in an element or in an attribute's value */
export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** The site's name in a language, as the site has it in that language, whether or not /en is on. Never the other one in its place. */
function siteName(lang: Lang) {
  const name = lang === "en" ? en.lib?.rules?.siteName : zh.lib.rules.siteName;
  if (!name) throw new Error(`intro: src/i18n/${lang}.ts has no lib.rules.siteName`);
  return name;
}

/** Where the number of players goes in a page as kept (introHtml): a character no template and no name has */
const PLAYERS_AT = "\u0000";

/** What goes in each of a template's blanks */
export function introFills(lang: Lang, english: boolean, gray: boolean, name = siteName(lang)): Record<string, string> {
  // the Chinese page leads to the Chinese map, whether or not the English one is open
  const toEnglish = english && lang === "en";
  return {
    siteName: escapeHtml(name),
    // the site's name in the other language, beside this one's
    otherSiteName: escapeHtml(siteName(lang === "en" ? "zh" : "en")),
    mapHref: toEnglish ? "/en" : "/",
    privacyHref: toEnglish ? "/en/privacy" : "/privacy",
    grayStyle: gray ? `<style>${GRAY_CSS}</style>` : "",
    declKm: String(DECLARATION_RADIUS_KM),
    minAge: String(MIN_SIGNUP_AGE),
    maxClones: String(MAX_CLONES),
    declDays: String(DECLARATION_DAYS),
    radarKm: String(RADAR_RADIUS_KM),
    helpHours: String(HELP_HOURS),
    // the thanks for sponsoring are left out: they are not earned in play, nor shown till had, as 325大学习's hidden two
    // are not; and 香艳制作人's until she is out for everyone, and 325大学习's until it is open to everyone
    badgeCount: String(earnableCount(haimaoMode() === "on", studyMode() === "on")),
    keepDays: String(KEEP_ACTIVITY_DAYS),
    players: PLAYERS_AT,
  };
}

/** The blocks a template may have, in pairs of which a page keeps one: <!--en:on-->…<!--/en:on--> and so on */
const BLOCKS = ["en:on", "en:off", "live", "nolive"];

/** Which of each pair a page keeps: the blocks for the English site on or off; for a number of players to give, or none */
export type Blocks = { english: boolean; live: boolean };

/**
 * A template as a page: the blocks it doesn't keep taken out, the markers of the others, and every {{blank}} filled.
 * A blank with nothing to fill it, or a block not closed, is a mistake in the template.
 */
export function fillIntro(template: string, keep: Blocks, fills: Readonly<Record<string, string>>) {
  for (const block of BLOCKS)
    if (template.split(`<!--${block}-->`).length !== template.split(`<!--/${block}-->`).length)
      throw new Error(`intro: a block <!--${block}--> of the template is not closed`);
  let page = template;
  for (const drop of [keep.english ? "en:off" : "en:on", keep.live ? "nolive" : "live"])
    page = page.replace(new RegExp(`<!--${drop}-->[\\s\\S]*?<!--/${drop}-->\\n?`, "g"), "");
  return page
    .replace(/<!--\/?(?:en:on|en:off|live|nolive)-->\n?/g, "")
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      if (!Object.hasOwn(fills, name)) throw new Error(`intro: nothing to fill {{${name}}} with`);
      return fills[name];
    });
}

/** A page as kept: whole, for when there is no number of players to give; and in two pieces around the number */
type Kept = { nolive: string; live: readonly [string, string] };

const pages = new Map<string, Kept>();

/** A page, made the first time it is asked for in this way */
function kept(lang: Lang, english: boolean, gray: boolean): Kept {
  const key = `${lang} ${english} ${gray}`;
  let page = pages.get(key);
  if (page === undefined) {
    const fills = introFills(lang, english, gray);
    const nolive = fillIntro(TEMPLATES[lang], { english, live: false }, fills);
    const live = fillIntro(TEMPLATES[lang], { english, live: true }, fills).split(PLAYERS_AT);
    if (live.length !== 2 || nolive.includes(PLAYERS_AT))
      throw new Error(`intro: the ${lang} template has to say the number of players once, in its <!--live--> block`);
    page = { nolive, live: [live[0], live[1]] };
    pages.set(key, page);
  }
  return page;
}

/** Numbers as the map writes them: 103,286, in either language */
const COUNT = new Intl.NumberFormat("en-US");

/** A page, saying how many players are on the map; with no number (null), the line it had before in its place */
export function introHtml(lang: Lang, english: boolean, gray: boolean, players: number | null) {
  const page = kept(lang, english, gray);
  return players === null ? page.nolive : page.live[0] + COUNT.format(players) + page.live[1];
}

/** How long a browser may keep a page: 全站变灰, a new release and the number of players reach it within that */
const MAX_AGE_S = 300;

/**
 * A page as its route answers. Everything in it comes from memory: 全站变灰 (src/lib/server/siteSettings.ts), the
 * server's ENGLISH (src/i18n/server.ts) and the number of players, from the roaches this process holds for the map
 * (src/lib/server/roachFeed.ts); it reads no session and no database.
 */
export function introResponse(lang: Lang) {
  return new Response(introHtml(lang, englishOn(), grayUntil() !== null, playersOnMapNow()), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": `public, max-age=${MAX_AGE_S}` },
  });
}
