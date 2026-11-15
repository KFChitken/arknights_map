#!/usr/bin/env node
// Write src/data/throwaway-email-domains.json: the domains of throwaway mail services (temporary
// addresses made in a click, many with inboxes anyone can read), which a new account may not be
// made with (src/lib/server/throwawayEmail.ts). They come from the disposable-email-domains list,
// dedicated to the public domain (CC0 1.0), at the commit below. Run from the repository root now
// and then, with a newer commit of the list (`git ls-remote` on its repository gives the latest):
//
//   node scripts/fetch-throwaway-domains.mjs [commit]
import { writeFileSync } from "node:fs";

const REPO = "https://github.com/disposable-email-domains/disposable-email-domains";
const COMMIT = process.argv[2] || "996ee98dac2e2d562a5aabec56a0444528e2657d";
const FILE = "disposable_email_blocklist.conf";
const OUT = "src/data/throwaway-email-domains.json";

/**
 * On the list but long-standing mail services that people keep their address at, left off it here.
 * 21cn.com: China Telecom's mail service, on the list since a batch of 2014.
 */
const NOT_THROWAWAY = new Set(["21cn.com"]);

/**
 * Names under which anyone can register a domain: one of them on the list would turn away every
 * address under it, a school's included. The list keeps clear of them (its own checks go by the
 * public suffix list); this stops the script should that ever change.
 */
const SUFFIXES = new Set([
  ...["com", "net", "org", "edu", "gov", "cn", "hk", "mo", "tw", "jp", "kr", "sg", "my", "uk", "au", "ca", "de", "fr", "io", "me"],
  ...["com.cn", "net.cn", "org.cn", "edu.cn", "ac.cn", "gov.cn", "com.hk", "edu.hk", "org.hk", "com.mo", "edu.mo", "com.tw", "edu.tw"],
  ...["co.jp", "ac.jp", "ne.jp", "or.jp", "co.kr", "ac.kr", "com.sg", "edu.sg", "com.my", "edu.my", "co.uk", "ac.uk", "org.uk"],
  ...["com.au", "edu.au", "net.au", "co.nz", "ac.nz", "com.br", "eu.org", "github.io", "dynv6.net"],
]);

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const DOMAIN = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);

const source = `https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/${COMMIT}/${FILE}`;
const res = await fetch(source);
if (!res.ok) throw new Error(`${res.status} ${source}`);
const lines = (await res.text())
  .split("\n")
  .map((l) => l.trim().toLowerCase())
  .filter((l) => l && !l.startsWith("#") && !l.startsWith("//"));

const bad = lines.filter((d) => !DOMAIN.test(d) || SUFFIXES.has(d));
if (bad.length) throw new Error(`not a domain of its own, so not written: ${bad.slice(0, 20).join(", ")}`);
const domains = [...new Set(lines)].filter((d) => !NOT_THROWAWAY.has(d)).sort();
if (domains.length < 1000) throw new Error(`only ${domains.length} domains: is ${FILE} still the list?`);

// a domain a line, so a newer list shows in a diff as the domains it adds and drops
const head = { source: REPO, commit: COMMIT, fetched: new Date().toISOString().slice(0, 10), license: "CC0-1.0" };
const json = JSON.stringify(head, null, 2).replace(/\n}$/, `,\n  "domains": [\n${domains.map((d) => `    ${JSON.stringify(d)}`).join(",\n")}\n  ]\n}\n`);
writeFileSync(OUT, json);
console.log(`${OUT}: ${domains.length} domains from ${FILE} at ${COMMIT.slice(0, 7)}, ${lines.length - domains.length} left off`);
