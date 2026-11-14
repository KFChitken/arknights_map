import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import GrayMode from "@/components/GrayMode";
import { fmt, fmtParts, localPath, T } from "@/i18n";
import { fmtNodes } from "@/i18n/nodes";
import { AWAY_DAYS, SURVIVOR_DAYS } from "@/lib/badges";
import { HOT_MIN_PLAYERS } from "@/lib/hotList";
import {
  DECLARATION_DAYS,
  DECLARATION_RADIUS_KM,
  INBOX_DAYS,
  KEEP_ACTIVITY_DAYS,
  KEEP_REPORT_DAYS,
  MIN_SIGNUP_AGE,
  POKE_EVERY_DAYS,
  PROFILE_REPORTS_TO_HOLD,
  RELIABLE_AFTER_DAYS,
  SESSION_DAYS,
  siteName,
  SUSPEND_DAYS,
  YELLOW_DAYS,
  YELLOWS_TO_WORRY,
} from "@/lib/rules";
import { RULES } from "@/lib/safety";
import { grayUntil } from "@/lib/server/siteSettings";

export const generateMetadata = (): Metadata => ({ title: fmt(T.server.privacy.metaTitle, { site: siteName() }) });
const CONTACT = "tungsam2003@gmail.com";
const BACKUP_DAYS = 14;

export default async function Privacy() {
  // rendered for each visit, so 全站变灰 shows here too
  await connection();
  return (
    <main className="doc">
      <GrayMode until={grayUntil(Date.now())} />
      <h1>{fmtParts(T.server.privacy.title, { site: siteName() })}</h1>
      <p className="hint">{T.server.privacy.effective}</p>

      <p>
        {fmtParts(T.server.privacy.intro, { operator: T.server.privacy.operator, site: siteName() })}
      </p>

      <h2>{T.server.privacy.collect.title}</h2>
      <ul>
        <li>
          {fmtNodes(T.server.privacy.collect.email, { b: <strong>{T.server.privacy.collect.emailB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.profile, { b: <strong>{T.server.privacy.collect.profileB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.roaches, { b: <strong>{T.server.privacy.collect.roachesB}</strong>, b2: <strong>{T.server.privacy.collect.roachesB2}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.acts, { b: <strong>{T.server.privacy.collect.actsB}</strong>, declarationDays: DECLARATION_DAYS, site: siteName() })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.drunk, { b: <strong>{T.server.privacy.collect.drunkB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.visits, { b: <strong>{T.server.privacy.collect.visitsB}</strong>, site: siteName(), b2: <strong>{T.server.privacy.collect.visitsB2}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.passes, { b: <strong>{T.server.privacy.collect.passesB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.away, { b: <strong>{T.server.privacy.collect.awayB}</strong>, site: siteName() })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.age, { b: <strong>{T.server.privacy.collect.ageB}</strong>, minSignupAge: MIN_SIGNUP_AGE, b2: <strong>{T.server.privacy.collect.ageB2}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.collect.security, { b: <strong>{T.server.privacy.collect.securityB}</strong>, sessionDays: SESSION_DAYS, b2: <strong>{T.server.privacy.collect.securityB2}</strong> })}
        </li>
      </ul>
      <p>{T.server.privacy.collect.notCollected}</p>

      <h2>{T.server.privacy.use.title}</h2>
      <p>
        {fmtParts(T.server.privacy.use.text, { awayDays: AWAY_DAYS, survivorDays: SURVIVOR_DAYS })}
      </p>

      <h2>{T.server.privacy.seen.title}</h2>
      <ul>
        <li>
          {fmtNodes(T.server.privacy.seen.map, { b: <strong>{T.server.privacy.seen.mapB}</strong>, b2: <strong>{T.server.privacy.seen.mapB2}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.clones, { b: <strong>{T.server.privacy.seen.clonesB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.drunk, { b: <strong>{T.server.privacy.seen.drunkB}</strong>, awayDays: AWAY_DAYS, pokeEveryDays: POKE_EVERY_DAYS })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.touch, { b: <strong>{T.server.privacy.seen.touchB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.uid, { b: <strong>{T.server.privacy.seen.uidB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.titles, { b: <strong>{T.server.privacy.seen.titlesB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.passes, { b: <strong>{T.server.privacy.seen.passesB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.hot, { b: <strong>{T.server.privacy.seen.hotB}</strong>, hotMinPlayers: HOT_MIN_PLAYERS })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.declare, { b: <strong>{T.server.privacy.seen.declareB}</strong>, declarationRadiusKm: DECLARATION_RADIUS_KM, declarationDays: DECLARATION_DAYS })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.replies, { b: <strong>{T.server.privacy.seen.repliesB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.friends, { b: <strong>{T.server.privacy.seen.friendsB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.block, { b: <strong>{T.server.privacy.seen.blockB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.seen.report, { b: <strong>{T.server.privacy.seen.reportB}</strong>, profileReportsToHold: PROFILE_REPORTS_TO_HOLD, reliableAfterDays: RELIABLE_AFTER_DAYS })}
        </li>
      </ul>

      <h2 id="abroad">{T.server.privacy.where.title}</h2>
      <p>{T.server.privacy.where.text}</p>
      <ul>
        <li>
          {fmtNodes(T.server.privacy.where.tencent, { b: <strong>{T.server.privacy.where.tencentB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.where.resend, { b: <strong>Resend USA</strong> })}
        </li>
      </ul>
      <p>
        {fmtNodes(T.server.privacy.where.mainland, { site: siteName(), link: <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noreferrer">
          {T.server.privacy.where.mainlandLink}
        </a> })}
      </p>
      <p>
        {fmtNodes(T.server.privacy.where.maps, { b: <strong>{T.server.privacy.where.mapsB}</strong> })}
      </p>
      <p>{T.server.privacy.where.noOthers}</p>

      <h2>{T.server.privacy.keep.title}</h2>
      <ul>
        <li>{T.server.privacy.keep.account}</li>
        <li>{T.server.privacy.keep.titles}</li>
        <li>
          {fmtParts(T.server.privacy.keep.acts, { keepActivityDays: KEEP_ACTIVITY_DAYS, inboxDays: INBOX_DAYS, declarationDays: DECLARATION_DAYS })}
        </li>
        <li>{T.server.privacy.keep.away}</li>
        <li>{T.server.privacy.keep.gameFriends}</li>
        <li>{T.server.privacy.keep.watch}</li>
        <li>{T.server.privacy.keep.help}</li>
        <li>{T.server.privacy.keep.codes}</li>
        <li>{T.server.privacy.keep.deskCodes}</li>
        <li>{T.server.privacy.keep.blocks}</li>
        <li>{fmtParts(T.server.privacy.keep.reports, { keepReportDays: KEEP_REPORT_DAYS })}</li>
        <li>{T.server.privacy.keep.cleared}</li>
        <li>{fmtParts(T.server.privacy.keep.notes, { keepActivityDays: KEEP_ACTIVITY_DAYS })}</li>
        <li>{T.server.privacy.keep.actions}</li>
        <li>{T.server.privacy.keep.adminLog}</li>
        <li>
          {T.server.privacy.keep.bans}
        </li>
        <li>
          {fmtParts(T.server.privacy.keep.backups, { backupDays: BACKUP_DAYS })}
        </li>
      </ul>

      <h2>{T.server.privacy.rights.title}</h2>
      <ul>
        <li>{T.server.privacy.rights.profile}</li>
        <li>{T.server.privacy.rights.roaches}</li>
        <li>
          {fmtNodes(T.server.privacy.rights.delete, { b: <strong>{T.server.privacy.rights.deleteB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.rights.withdraw, { b: <strong>{T.server.privacy.rights.withdrawB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.rights.ask, { link: <a href={`mailto:${CONTACT}`}>{CONTACT}</a> })}
        </li>
      </ul>

      <h2>{T.server.privacy.rules.title}</h2>
      {/* each rule starts with the words a player's 站长通知 quotes (src/lib/safety.ts RULES) */}
      <ul>
        <li>{fmtParts(T.server.privacy.rules.rule, { rule: RULES.name })}</li>
        <li>{fmtParts(T.server.privacy.rules.contact, { rule: RULES.contact })}</li>
        <li>{fmtParts(T.server.privacy.rules.rule, { rule: RULES.impersonate })}</li>
        <li>{fmtParts(T.server.privacy.rules.rule, { rule: RULES.harass })}</li>
        <li>{fmtParts(T.server.privacy.rules.rule, { rule: RULES.age })}</li>
        <li>{fmtParts(T.server.privacy.rules.roach, { rule: RULES.roach })}</li>
      </ul>
      <p>{T.server.privacy.rules.names}</p>

      <h2>{T.server.privacy.enforce.title}</h2>
      <p>
        {fmtParts(T.server.privacy.enforce.text, { minSignupAge: MIN_SIGNUP_AGE, yellowDays: YELLOW_DAYS, yellowsToWorry: YELLOWS_TO_WORRY, suspendDays: SUSPEND_DAYS, inboxDays: INBOX_DAYS })}
      </p>

      <h2 id="contact">{T.map.contact}</h2>
      <ul>
        <li>
          {fmtNodes(T.server.privacy.contact.inSite, { b: <strong>{T.server.privacy.contact.inSiteB}</strong> })}
        </li>
        <li>
          {fmtNodes(T.server.privacy.contact.outside, { b: <strong>{T.server.privacy.contact.outsideB}</strong>, link: <a href={`mailto:${CONTACT}`}>{CONTACT}</a> })}
        </li>
      </ul>

      <h2>{T.server.privacy.minors.title}</h2>
      <p>
        {fmtParts(T.server.privacy.minors.text, { site: siteName(), minSignupAge: MIN_SIGNUP_AGE })}
      </p>

      <h2>{T.server.privacy.security.title}</h2>
      <p>
        {T.server.privacy.security.text}
      </p>

      <h2>{T.server.privacy.images.title}</h2>
      <p>
        {fmtParts(T.server.privacy.images.text, { site: siteName() })}
      </p>

      <h2>{T.server.privacy.updates.title}</h2>
      <p>
        {T.server.privacy.updates.text}
      </p>

      <p className="hint">
        {fmtNodes(T.server.privacy.footer.operator, { operator: T.server.privacy.operator, link: <a href={`mailto:${CONTACT}`}>{CONTACT}</a> })}
        <br />
        {fmtNodes(T.server.privacy.footer.fan, { site: siteName(), back: <Link href={localPath("/")}>{T.server.privacy.footer.back}</Link> })}
      </p>
    </main>
  );
}
