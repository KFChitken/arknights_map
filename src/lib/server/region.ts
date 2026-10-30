import "server-only";
import data from "@/data/cn-ip-ranges.json";

/**
 * Whether a visitor's address is in mainland China, by the blocks APNIC has given
 * out there (scripts/fetch-cn-ranges.mjs). The address is only looked at here, in
 * memory, to pick the map: it is never stored or logged.
 */

type Range<T> = readonly [T, T];

// Sorted and joined by the script. IPv6 goes by its first 64 bits: no block there is smaller than a /48
const V4 = data.v4.map(([a, b]): Range<number> => [a, b]);
const V6 = (data.v6 as [string, string][]).map(([a, b]): Range<bigint> => [BigInt(`0x${a}`), BigInt(`0x${b}`)]);

function v4Number(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** The first 64 bits of an IPv6 address. */
function v6Top(ip: string): bigint | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string) => (s ? s.split(":") : []);
  const [left, right] = [groups(halves[0]), groups(halves[1] ?? "")];
  const all = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return all.slice(0, 4).reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}

function within<T extends number | bigint>(ranges: Range<T>[], n: T) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (n < ranges[mid][0]) hi = mid - 1;
    else if (n > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

export function inMainland(ip: string): boolean {
  const addr = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  // an IPv4 address written as IPv6, like ::ffff:1.2.3.4
  const four = v4Number(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr)?.[1] ?? addr);
  if (four !== null) return within(V4, four);
  const six = v6Top(addr);
  return six !== null && within(V6, six);
}
