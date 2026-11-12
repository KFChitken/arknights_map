import "server-only";
import { T } from "@/i18n";
import { beijingDate } from "../beijing";
import { fromGcj, shifted, toGcj } from "../coords";
import { distanceKm } from "../geo";
import type { Place, PlaceResults } from "../geocode";
import { nominatimPlaces, nominatimUrl, photonPlaces, photonUrl } from "../osm";
import type { MapView } from "../types";
import { fetchVia } from "./fetchVia";
import { HttpError } from "./http";
import { allow } from "./rateLimit";
import { errorCode, note } from "./signals";

/**
 * Place search for visitors from mainland China (POST /api/geo), who cannot reach OpenStreetMap's
 * own searches (Nominatim is blocked there): our server asks Photon while they type, and on 搜索
 * Nominatim and 高德 (its web service), 高德's places first. 高德 gives a personal account 5000
 * searches a month and no way to buy more, so the server spends at most AMAP_SEARCH_DAILY of them
 * a day (Beijing time), three a second at most, and none for the rest of the day once 高德 says
 * the allowance is used up. The words searched say roughly where a player lives, so they are never
 * logged or stored; only kept in memory with what OpenStreetMap found, for a day, which Nominatim's
 * usage policy asks for too. 高德's places are never kept (its terms, 3.5): asked again, it is asked again.
 */

/** Asks from one address in a minute */
export const GEO_PER_ADDRESS = 30;
/** Photon asks from the whole site in a minute: one a second, the public service is free and shared */
export const PHOTON_PER_MINUTE = 60;
/**
 * After this many Photon failures in a row it is left alone for PHOTON_REST_MS, typing then getting no
 * suggestions at once instead of waiting for nothing. 2026-11-10: once Tencent's 6000 a day were gone,
 * every mainland keystroke came here, and Photon refused our server's connections for hours.
 */
export const PHOTON_FAILS = 5;
export const PHOTON_REST_MS = 15 * 60_000;
/** Nominatim asks waiting their turn (one a second for the whole site, its rule) before the next is turned away */
export const NOMINATIM_WAITING = 5;
export const geoBusy = () => T.server.geo.busy;

const AGENT = "zhoupmap.com place search (+https://zhoupmap.com)";
const TIMEOUT_MS = 5000;
const KEEP = 5000;
const KEEP_MS = 24 * 3600_000;

const kept = new Map<string, { at: number; found: PlaceResults }>();
let nominatimNext = 0;
let waiting = 0;
let photonFails = 0;
let photonRestUntil = 0;
let amapNext = 0;
/** 高德 searches spent today, and what 高德 said when it turned the server away today */
let amapDay = { date: "", used: 0, out: null as string | null };

export type GeoAsk = { kind: "suggest" | "search"; q: string; near?: MapView };

/** For tests: as a fresh process */
export function forgetGeo() {
  kept.clear();
  nominatimNext = 0;
  waiting = 0;
  photonFails = 0;
  photonRestUntil = 0;
  amapNext = 0;
  amapDay = { date: "", used: 0, out: null };
}

/**
 * Where Photon is asked from (host:port, PHOTON_VIA): the second server's private address on the
 * live site, since Photon refused the main server's own (2026-11-11); unset, straight from here.
 */
const photonVia = () => process.env.PHOTON_VIA || "";

/** 高德's web service key (server .env); without it, OpenStreetMap only */
const amapKey = () => process.env.AMAP_WEBSERVICE_KEY || "";
/** 高德 searches a day: the monthly 5000 spread over the month, with a little to spare */
const amapDaily = () => Math.max(0, Math.floor(Number(process.env.AMAP_SEARCH_DAILY ?? 150)));

/** Today's 高德 searches, for the site's checks: how many were spent, of how many, and what 高德 said if it said no */
export function amapSearchToday(now = Date.now()) {
  const date = beijingDate(now);
  if (amapDay.date !== date) amapDay = { date, used: 0, out: null };
  return { used: amapDay.used, daily: amapDaily(), out: amapDay.out };
}

export async function geoSearch(address: string, ask: GeoAsk, fetcher: typeof fetch = fetch): Promise<PlaceResults> {
  if (!allow(`geo:${address}`, GEO_PER_ADDRESS, 60_000)) throw new HttpError(429, geoBusy());
  const near = ask.near ? `${ask.near.lng.toFixed(2)},${ask.near.lat.toFixed(2)},${Math.round(ask.near.zoom)}` : "";
  const key = `${ask.kind}|${ask.q}|${near}`;
  const hit = keptFor(key);
  if (hit) return hit;

  let found: PlaceResults;
  if (ask.kind === "suggest") {
    // resting: no suggestions, and nothing kept, so the words are asked again once Photon is back
    if (Date.now() < photonRestUntil) return { places: [], osm: false };
    if (!allow("geo-photon", PHOTON_PER_MINUTE, 60_000)) throw new HttpError(429, geoBusy());
    try {
      // through the second server on the live site (the tests' own fetchers are asked as they are)
      const viaPhoton = photonVia() && fetcher === fetch ? fetchVia(photonVia()) : fetcher;
      found = { places: photonPlaces(await ask_(viaPhoton, "Photon", photonUrl(ask.q, ask.near))), osm: true };
      photonFails = 0;
    } catch (e) {
      if (++photonFails >= PHOTON_FAILS) {
        photonFails = 0;
        photonRestUntil = Date.now() + PHOTON_REST_MS;
        console.error("geo: Photon left alone for a while");
      }
      throw e;
    }
  } else {
    // 高德's terms (3.5) let nobody keep its data, so only what OpenStreetMap found is kept for next time
    const osmKey = `osm|${ask.q}|${near}`;
    const keptOsm = keptFor(osmKey);
    const [amap, osm] = await Promise.allSettled([
      amapSearch(fetcher, ask.q, ask.near),
      keptOsm
        ? Promise.resolve(keptOsm.places)
        : nominatimTurn().then(async () => nominatimPlaces(await ask_(fetcher, "Nominatim", nominatimUrl(ask.q, ask.near)))),
    ]);
    if (osm.status === "fulfilled" && !keptOsm) keep(osmKey, { places: osm.value, osm: true });
    const fromAmap = amap.status === "fulfilled" ? amap.value.slice(0, 6) : [];
    if (!fromAmap.length && osm.status === "rejected") throw osm.reason;
    // skip OSM hits that are the same place 高德 already found
    const fromOsm = (osm.status === "fulfilled" ? osm.value : [])
      .filter((o) => !fromAmap.some((a) => a.name === o.name && distanceKm(a, o) < 0.5))
      .slice(0, fromAmap.length ? 4 : 8);
    found = { places: [...fromAmap, ...fromOsm], osm: fromOsm.length > 0, amap: fromAmap.length > 0 };
    if (found.amap) return found;
  }
  keep(key, found);
  return found;
}

/** What was found for this ask within KEEP_MS, if anything */
function keptFor(key: string): PlaceResults | null {
  const hit = kept.get(key);
  return hit && Date.now() - hit.at < KEEP_MS ? hit.found : null;
}

function keep(key: string, found: PlaceResults) {
  kept.set(key, { at: Date.now(), found });
  if (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
}

/** One ask of an OpenStreetMap search, as JSON */
async function ask_(fetcher: typeof fetch, who: string, url: string): Promise<unknown> {
  try {
    const res = await fetcher(url, { headers: { "user-agent": AGENT, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw Object.assign(new Error("not ok"), { code: `HTTP${res.status}` });
    return await res.json();
  } catch (e) {
    // only the error's code: the address asked holds the words searched
    console.error(`geo: ${who} failed`, errorCode(e));
    throw new HttpError(502, T.server.geo.unavailable);
  }
}

type AmapAnswer = { status?: string; info?: string; infocode?: string; pois?: AmapPlace[]; geocodes?: AmapPlace[] };
type AmapPlace = Record<string, unknown> & { location?: unknown };

/**
 * 高德's places for a search: around the map's center (50 km) when it shows China close enough,
 * by keyword otherwise, and plain addresses and districts (上海市徐汇区) from its geocoder when
 * neither finds anything; that one counts against another, larger allowance. Nothing when the
 * day's share is spent or 高德 said no today.
 */
async function amapSearch(fetcher: typeof fetch, q: string, near?: MapView): Promise<Place[]> {
  const key = amapKey();
  const today = amapSearchToday();
  if (!key || today.out || today.used >= today.daily) return [];
  const close = near && near.zoom >= 5 && shifted(near);
  const params = new URLSearchParams({ key, keywords: q, offset: "8", page: "1", extensions: "base", output: "JSON" });
  if (close) {
    // 高德 wants its own (GCJ-02) spot
    const [lng, lat] = toGcj(near);
    params.set("location", `${lng.toFixed(6)},${lat.toFixed(6)}`);
    params.set("radius", "50000");
  }
  amapDay.used++;
  const pois = (await amapAsk(fetcher, `https://restapi.amap.com/v3/place/${close ? "around" : "text"}?${params}`))?.pois ?? [];
  const places = pois.flatMap((p) => amapPlace(p, String(p.name ?? ""), [p.pname, p.cityname, p.adname, p.address]));
  // 高德 just said no for the day: not its geocoder either
  if (places.length || amapDay.out) return places;
  const codes = (await amapAsk(fetcher, `https://restapi.amap.com/v3/geocode/geo?${new URLSearchParams({ key, address: q, output: "JSON" })}`))?.geocodes ?? [];
  return codes.flatMap((c) => amapPlace(c, String(c.formatted_address ?? ""), [c.level]));
}

/** One ask of 高德, three a second at most for the whole site. A no that means the allowance is gone stops it for the day. */
async function amapAsk(fetcher: typeof fetch, url: string): Promise<AmapAnswer | null> {
  const now = Date.now();
  const at = Math.max(now, amapNext);
  amapNext = at + 334;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.json()) as AmapAnswer;
    if (body.status === "1") return body;
    const info = String(body.info ?? "").replace(/[^\w]/g, "").slice(0, 40);
    if (/LIMIT|QUOTA|RUN_OUT|INSUFFICIENT/.test(info)) {
      amapSearchToday();
      amapDay.out = info;
      note("map", `amap:search:${info}`);
    }
    console.error("geo: 高德 said no", info, body.infocode ?? "");
    return null;
  } catch (e) {
    // never the address asked: it holds the key and the words searched
    console.error("geo: 高德 failed", errorCode(e));
    return null;
  }
}

/** 高德's spots are GCJ-02 in China; ours are WGS-84 */
function amapPlace(p: AmapPlace, name: string, details: unknown[]): Place[] {
  const [lng, lat] = String(p.location ?? "").split(",").map(Number);
  if (!name || !Number.isFinite(lng) || !Number.isFinite(lat)) return [];
  const detail = details
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .filter((s, i, a) => a.indexOf(s) === i)
    .join(" · ");
  return [{ ...fromGcj(lng, lat), name, detail }];
}

/** Wait for Nominatim's next free second; with too many already waiting, the ask is turned away. */
async function nominatimTurn() {
  if (waiting >= NOMINATIM_WAITING) throw new HttpError(429, geoBusy());
  waiting++;
  try {
    const now = Date.now();
    const at = Math.max(now, nominatimNext);
    nominatimNext = at + 1000;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  } finally {
    waiting--;
  }
}
