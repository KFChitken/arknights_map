import { reportMapTrouble } from "@/components/map/report";
import { nominatimPlaces, nominatimUrl, photonPlaces, photonUrl } from "./osm";
import { tencentTips } from "./tencent";
import type { LngLat, MapView } from "./types";
import { apiFetch } from "@/lib/apiFetch";

/** A search hit, always in WGS-84. */
export type Place = LngLat & { name: string; detail: string };

/**
 * osm, tencent: some places came from OpenStreetMap or from 腾讯位置服务, which then need crediting;
 * amap: some came from 高德, whose terms let nobody keep them, so they are not kept even on the page
 */
export type PlaceResults = { places: Place[]; osm: boolean; tencent?: boolean; amap?: boolean };

/** Our server's place search (/api/geo) has too many waiting: the player can try again in a moment */
export class SearchBusy extends Error {}

/*
 * Place search while putting a roach down. cn, a visitor from mainland China: suggestions while
 * typing come from 腾讯位置服务 (src/lib/tencent.ts), and everything else goes through our server
 * (src/app/api/geo/route.ts), which reaches OpenStreetMap's searches (they cannot from there) and,
 * on 搜索, 高德's within its daily share of the monthly allowance. Everyone else asks
 * OpenStreetMap from the browser. A page never asks twice for the same thing:
 * what it found is kept here, for this page only.
 */

const KEPT = 50;
const kept = new Map<string, PlaceResults>();

/** The same search around the same spot (to 0.1°) is answered from what this page found before. */
async function keep(key: (string | number)[], look: () => Promise<PlaceResults>): Promise<PlaceResults> {
  const k = key.join("|");
  const hit = kept.get(k);
  if (hit) return hit;
  const found = await look();
  if (found.amap) return found;
  kept.set(k, found);
  if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  return found;
}

const around = (near?: LngLat) => (near ? `${near.lng.toFixed(1)},${near.lat.toFixed(1)}` : "");

/**
 * Suggestions while typing, from Photon (an OSM geocoder built for search-as-you-type); from
 * mainland China first from Tencent, and from Photon through our server when Tencent has nothing,
 * is slow or says no. near, when given, ranks places around that point first.
 */
export async function suggestPlaces(query: string, near?: LngLat, cn = false): Promise<PlaceResults> {
  const q = query.trim();
  if (!q) return { places: [], osm: false };
  return keep(["tips", cn ? "cn" : "", q, around(near)], async () => {
    if (!cn) return { places: await photonSearch(q, near), osm: true };
    const tips = await tencentTips(q, near, (status) => reportMapTrouble("tencent", "search", String(status)));
    if (tips?.length) return { places: tips, osm: false, tencent: true };
    return { places: (await throughServer("suggest", q, near)).places, osm: true };
  });
}

/**
 * Full search when the player presses 搜索: Nominatim, which also knows Chinese names of places
 * abroad, and from mainland China 高德's places first. near, when given, is the map view: places
 * around it come first, so 人民广场 seen over Shanghai is not the one in Kuala Lumpur.
 */
export async function searchPlaces(query: string, near?: MapView, cn = false): Promise<PlaceResults> {
  const q = query.trim();
  if (!q) return { places: [], osm: false };
  return keep(["search", cn ? "cn" : "", q, around(near), near ? Math.round(near.zoom) : ""], async () =>
    cn ? throughServer("search", q, near) : { places: await nominatimSearch(q, near), osm: true },
  );
}

// Nominatim's usage policy allows at most one request per second and no search-as-you-type
let lastNominatim = 0;

async function nominatimSearch(q: string, near?: MapView): Promise<Place[]> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(nominatimUrl(q, near));
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return nominatimPlaces(await res.json());
}

async function photonSearch(q: string, near?: LngLat): Promise<Place[]> {
  const res = await fetch(photonUrl(q, near));
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return photonPlaces(await res.json());
}

/** Ask our server: the words go in the request's body, never in an address that could be logged */
async function throughServer(kind: "suggest" | "search", q: string, near?: LngLat & { zoom?: number }): Promise<PlaceResults> {
  const res = await apiFetch("/api/geo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind,
      q,
      near: near && { lng: near.lng, lat: near.lat, zoom: near.zoom },
      // development: /?mainland=1 pretends to be in mainland China, and so does this
      mainland: process.env.NODE_ENV !== "production",
    }),
  });
  if (res.status === 429) throw new SearchBusy();
  if (!res.ok) throw new Error(`geo ${res.status}`);
  return (await res.json()) as PlaceResults;
}
