import { en } from "@/i18n/en";
import { BADGES } from "@/lib/badges";
import { GRAY_CSS } from "@/lib/grayMode";
import { HELP_HOURS } from "@/lib/help";
import { DECLARATION_DAYS, DECLARATION_RADIUS_KM, KEEP_ACTIVITY_DAYS, MAX_CLONES, MIN_SIGNUP_AGE, RADAR_RADIUS_KM } from "@/lib/rules";
import { INTRO_TEMPLATE } from "./introTemplate";

/**
 * The intro page (./route.ts) from its template (./introTemplate.ts): the blanks filled from the code, made once for
 * each of the four ways it can be (the English site on or off, the whole site gray or not) and kept.
 */

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Text for HTML, in an element or in an attribute's value */
export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** The English site's name, as /en has it, whether or not /en is on. Never the Chinese one in its place. */
function siteName() {
  const name = en.lib?.rules?.siteName;
  if (!name) throw new Error("intro: src/i18n/en.ts has no lib.rules.siteName");
  return name;
}

/** What goes in each of the template's blanks */
export function introFills(english: boolean, gray: boolean, name = siteName()): Record<string, string> {
  return {
    siteName: escapeHtml(name),
    mapHref: english ? "/en" : "/",
    privacyHref: english ? "/en/privacy" : "/privacy",
    grayStyle: gray ? `<style>${GRAY_CSS}</style>` : "",
    declKm: String(DECLARATION_RADIUS_KM),
    minAge: String(MIN_SIGNUP_AGE),
    maxClones: String(MAX_CLONES),
    declDays: String(DECLARATION_DAYS),
    radarKm: String(RADAR_RADIUS_KM),
    helpHours: String(HELP_HOURS),
    badgeCount: String(BADGES.length),
    keepDays: String(KEEP_ACTIVITY_DAYS),
  };
}

/**
 * A template as a page: the blocks for the other state of the English site taken out, the markers of the others,
 * and every {{blank}} filled. A blank with nothing to fill it, or a block not closed, is a mistake in the template.
 */
export function fillIntro(template: string, english: boolean, fills: Readonly<Record<string, string>>) {
  for (const block of ["en:on", "en:off"])
    if (template.split(`<!--${block}-->`).length !== template.split(`<!--/${block}-->`).length)
      throw new Error(`intro: a block <!--${block}--> of the template is not closed`);
  const drop = english ? "en:off" : "en:on";
  return template
    .replace(new RegExp(`<!--${drop}-->[\\s\\S]*?<!--/${drop}-->\\n?`, "g"), "")
    .replace(/<!--\/?en:o(?:n|ff)-->\n?/g, "")
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
      if (!Object.hasOwn(fills, name)) throw new Error(`intro: nothing to fill {{${name}}} with`);
      return fills[name];
    });
}

const pages = new Map<string, string>();

/** The page, made the first time it is asked for in this way */
export function introHtml(english: boolean, gray: boolean) {
  const key = `${english} ${gray}`;
  let html = pages.get(key);
  if (html === undefined) {
    html = fillIntro(INTRO_TEMPLATE, english, introFills(english, gray));
    pages.set(key, html);
  }
  return html;
}
