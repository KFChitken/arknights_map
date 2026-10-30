#!/usr/bin/env node
// Write src/data/cn-ip-ranges.json: the address blocks APNIC has given out in mainland
// China (country code CN; Hong Kong, Macao and Taiwan have codes of their own). The server
// checks a visitor's address against them in memory to pick the map (src/lib/server/region.ts).
// Run from the repository root now and then; the registry changes slowly:
//
//   node scripts/fetch-cn-ranges.mjs
import { writeFileSync } from "node:fs";

const SOURCE = "https://ftp.apnic.net/stats/apnic/delegated-apnic-latest";
const OUT = "src/data/cn-ip-ranges.json";

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`${res.status} ${SOURCE}`);
const lines = (await res.text()).split("\n");
// the header's sixth field is the day the file was made, like 20261030
const made = lines.find((l) => /^\d/.test(l))?.split("|")[5] ?? "";

const v4Number = (ip) => BigInt(ip.split(".").reduce((n, part) => n * 256 + Number(part), 0));
function v6Number(ip) {
  const [left, right = ""] = ip.split("::");
  const groups = (s) => (s ? s.split(":") : []);
  const all = ip.includes("::")
    ? [...groups(left), ...Array(8 - groups(left).length - groups(right).length).fill("0"), ...groups(right)]
    : groups(left);
  return all.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

const v4 = [];
const v6 = [];
for (const line of lines) {
  const [registry, cc, type, start, value, , status] = line.split("|");
  if (registry !== "apnic" || cc !== "CN" || !["allocated", "assigned"].includes(status)) continue;
  // IPv4 rows give a count of addresses, IPv6 rows a prefix length
  if (type === "ipv4") v4.push([v4Number(start), v4Number(start) + BigInt(value) - 1n]);
  if (type === "ipv6") v6.push([v6Number(start), v6Number(start) + (1n << BigInt(128 - Number(value))) - 1n]);
}

/** Sorted, with neighbouring blocks joined into one range. */
function joined(ranges) {
  const out = [];
  for (const r of ranges.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const last = out.at(-1);
    if (last && r[0] <= last[1] + 1n) last[1] = r[1] > last[1] ? r[1] : last[1];
    else out.push([...r]);
  }
  return out;
}

// IPv4 as numbers; IPv6 by its first 64 bits in hex (no block is smaller than a /48);
// both as [first, last] address ranges
const v4Ranges = joined(v4).map(([a, b]) => [Number(a), Number(b)]);
const top64 = (n) => (n >> 64n).toString(16).padStart(16, "0");
const v6Ranges = joined(v6).map(([a, b]) => [top64(a), top64(b)]);

writeFileSync(OUT, `${JSON.stringify({ source: SOURCE, made, v4: v4Ranges, v6: v6Ranges })}\n`);
console.log(`${OUT}: ${v4Ranges.length} IPv4 and ${v6Ranges.length} IPv6 ranges, from APNIC's file of ${made}`);
