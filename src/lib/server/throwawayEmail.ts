import "server-only";
import { domainToASCII } from "node:url";
import { T } from "@/i18n";
import data from "@/data/throwaway-email-domains.json";
import { THROWAWAY_EMAIL } from "../rules";
import { throwawayCheckOn, throwawayOkDomains } from "./env";
import { HttpError } from "./http";

/**
 * Throwaway mail services: temporary addresses anyone can make in a click, many with inboxes anyone can
 * read (Guerrilla Mail's, say). No new account is made with one (src/app/api/auth/verify, signup), but an
 * account made with one before signs in as it always has: only a code that would start a sign-up is
 * refused. The domains are a public list
 * (src/data/throwaway-email-domains.json, from scripts/fetch-throwaway-domains.mjs), each with the names
 * under it (mail.example.com goes as example.com). THROWAWAY_CHECK=off and THROWAWAY_OK_DOMAINS (env.ts)
 * switch it off, or let a domain wrongly on the list through.
 */
const LISTED: ReadonlySet<string> = new Set(data.domains);

/**
 * The address's domain as mail goes to it (lower case, in ASCII, any dot at the end dropped), then each
 * domain above it down to two labels: a.b.example.com → a.b.example.com, b.example.com, example.com.
 */
function domainsOf(email: string): string[] {
  const typed = email
    .slice(email.lastIndexOf("@") + 1)
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
  // 例子.cc as xn--fsqu00a.cc, as the list writes such names; "" for a name no mail could go to
  const labels = (domainToASCII(typed) || typed).split(".");
  return labels.slice(0, -1).map((_, i) => labels.slice(i).join("."));
}

/** Whether a new account may not be made with this address: its domain, or one above it, is a throwaway mail service's */
export function isThrowawayEmail(email: string): boolean {
  if (!throwawayCheckOn()) return false;
  const domains = domainsOf(email);
  const ok = throwawayOkDomains();
  return !domains.some((d) => ok.has(d)) && domains.some((d) => LISTED.has(d));
}

/**
 * The refusal of a new account at a throwaway mail service, given once the code has shown the address is
 * the player's own, so it tells nobody else whether that address has an account. It names neither the
 * domain nor the list; the sign-in sheet goes back to the email by its code.
 */
export const throwawayRefusal = () => new HttpError(403, T.server.throwawayEmail.newAccount, THROWAWAY_EMAIL);
