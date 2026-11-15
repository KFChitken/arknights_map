import "server-only";
import { asc, eq } from "drizzle-orm";
import {
  cardMonth,
  ledger,
  repaidOf,
  type LedgerRow,
  type SponsorAdmin,
  type SponsorMonth,
  type SponsorSettings,
  type SponsorStartup,
  type SponsorView,
  type StartupPaid,
} from "../sponsor";
import { isModHere, isOwnerEmail } from "./admins";
import { db } from "./db";
import { sponsorMode } from "./env";
import { sponsorMonths, sponsorSettings, users, type UserRow } from "./schema";

/**
 * 支持舟P地图's settings and accounts (src/lib/sponsor.ts), kept by the owner in the 管理台
 * (src/lib/server/sponsorAdmin.ts). Players read them through a copy each process keeps for KEEP_MS; a change
 * from the 管理台 shows at once in the process it went to, and in the others within KEEP_MS. Shown only to those
 * SPONSOR lets see it (env.ts): to anyone else, there is no 支持舟P地图.
 */

/** Whether SPONSOR shows 支持舟P地图 to this player, or a visitor (null): anyone (on), the 站长 and the admins (admins), or nobody (off) */
export function sponsorOpen(user: Pick<UserRow, "id" | "email"> | null): boolean {
  const mode = sponsorMode();
  return mode === "on" || (mode === "admins" && user !== null && (isOwnerEmail(user.email) || isModHere(user.id)));
}

/**
 * Whether a viewer sees the thanks for sponsoring others hold, on their cards (world.ts cardsOf): as sponsorOpen,
 * asking the database for the viewer's email only while SPONSOR is admins; viewer null: a visitor
 */
export async function thanksShownTo(viewerId: string | null): Promise<boolean> {
  const mode = sponsorMode();
  if (mode !== "admins") return mode === "on";
  if (!viewerId) return false;
  if (isModHere(viewerId)) return true;
  const [v] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, viewerId)).limit(1);
  return Boolean(v && sponsorOpen(v));
}

type Stored = { settings: SponsorSettings; startup: SponsorStartup; months: SponsorMonth[] };

const OFF: SponsorSettings = { enabled: false, afdian: "", kofi: "" };
const NO_STARTUP: SponsorStartup = { spent: 0, note: "" };
export const KEEP_MS = 30_000;

async function read(): Promise<Stored> {
  const [[row], months] = await Promise.all([
    db.select().from(sponsorSettings).where(eq(sponsorSettings.id, 1)).limit(1),
    db.select().from(sponsorMonths).orderBy(asc(sponsorMonths.month)),
  ]);
  return {
    settings: row ? { enabled: row.enabled, afdian: row.afdian, kofi: row.kofi } : OFF,
    startup: row ? { spent: row.startupFen, note: row.startupNote } : NO_STARTUP,
    months: months.map((m) => ({ month: m.month, spent: m.spentFen, received: m.receivedFen, note: m.note })),
  };
}

let kept: { at: number; stored: Promise<Stored> } | null = null;

/** The settings and months as players get them: read again once the copy is KEEP_MS old; a failed read is not kept */
function stored(now: number) {
  if (!kept || now - kept.at >= KEEP_MS) {
    const fresh = read();
    kept = { at: now, stored: fresh };
    fresh.catch(() => {
      if (kept?.stored === fresh) kept = null;
    });
  }
  return kept.stored;
}

/** The owner changed something (and tests): read again on the next ask */
export function forgetSponsor() {
  kept = null;
}

/** The entry shows only switched on and with an 爱发电 link, the card's main button */
const shows = (s: SponsorSettings) => s.enabled && Boolean(s.afdian);

/** Every month oldest first, and what starting the site cost with how much of it they have paid back */
function accounts({ startup, months }: Stored): { startup: StartupPaid; rows: LedgerRow[] } {
  const rows = ledger(months, startup.spent);
  return { startup: { ...startup, repaid: repaidOf(rows) }, rows };
}

/**
 * me()'s 支持舟P地图, for its button on the map: true while it shows to this player (sponsorOpen, and switched on with
 * an 爱发电 link); a settings read that fails leaves the button out rather than the player's whole page
 */
export async function sponsorMe(user: Pick<UserRow, "id" | "email">, now = Date.now()): Promise<true | undefined> {
  if (!sponsorOpen(user)) return undefined;
  try {
    return shows((await stored(now)).settings) || undefined;
  } catch {
    return undefined;
  }
}

/** The card as this viewer (null: a visitor) sees it, but for their email; null while the entry is off, or not shown to them */
export async function sponsorCard(viewer: Pick<UserRow, "id" | "email"> | null, now = Date.now()): Promise<Omit<SponsorView, "email"> | null> {
  if (!sponsorOpen(viewer)) return null;
  const data = await stored(now);
  if (!shows(data.settings)) return null;
  const { startup, rows } = accounts(data);
  return {
    afdian: data.settings.afdian,
    kofi: data.settings.kofi || null,
    month: cardMonth(rows, now),
    repaying: startup.repaid < startup.spent,
  };
}

/**
 * /support: the card, what starting the site cost and how much of it is paid back (null when none is given),
 * and every month newest first; null while the entry is off, or not shown to this viewer (null: a visitor)
 */
export async function sponsorLedger(
  viewer: Pick<UserRow, "id" | "email"> | null,
  now = Date.now(),
): Promise<{ card: Omit<SponsorView, "email">; startup: StartupPaid | null; months: LedgerRow[] } | null> {
  const card = await sponsorCard(viewer, now);
  if (!card) return null;
  const { startup, rows } = accounts(await stored(now));
  return { card, startup: startup.spent > 0 ? startup : null, months: rows.reverse() };
}

/** The 管理台's 支持舟P地图, read afresh: everything as stored, the months newest first, and whether it shows and to whom */
export async function sponsorForAdmin(): Promise<SponsorAdmin> {
  const data = await read();
  const { startup, rows } = accounts(data);
  return { ...data.settings, shows: shows(data.settings), mode: sponsorMode(), startup, months: rows.reverse() };
}
