import type { Place } from "./geocode";
import type { LngLat, MapView } from "./types";

/**
 * The OpenStreetMap place searches, built and read the same way whether the browser asks them
 * itself or our server asks for a visitor in mainland China (src/app/api/geo/route.ts):
 * Photon while typing, Nominatim when the player presses 搜索.
 */

/** Photon: an OSM geocoder made for search-as-you-type. near ranks places around it first. */
export function photonUrl(q: string, near?: LngLat) {
  const url = new URL("https://photon.komoot.io/api/");
  // "default" keeps local names (中文 in China) instead of following the browser language
  const params = new URLSearchParams({ q, limit: "8", lang: "default" });
  if (near) {
    params.set("lat", near.lat.toFixed(4));
    params.set("lon", near.lng.toFixed(4));
  }
  url.search = params.toString();
  return url.toString();
}

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Partial<Record<"name" | "street" | "district" | "city" | "county" | "state" | "country", string>>;
};

export function photonPlaces(body: unknown): Place[] {
  const { features = [] } = (body ?? {}) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return features.flatMap(({ geometry, properties: p }) => {
    const name = p.name || p.street || p.city || "";
    const detail = [p.street, p.district, p.city ?? p.county, p.state, p.country]
      .filter((s, i, a) => s && s !== name && a.indexOf(s) === i)
      .join(" · ");
    if (!name || seen.has(name + detail)) return [];
    seen.add(name + detail);
    return [{ lng: geometry.coordinates[0], lat: geometry.coordinates[1], name, detail }];
  });
}

/**
 * Nominatim, which also knows Chinese names of places abroad. Its usage policy allows at most
 * one request a second and no search-as-you-type. near, the map view, makes a preferred box:
 * places outside it still come, just later.
 */
export function nominatimUrl(q: string, near?: MapView) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "8", "accept-language": "zh-CN,zh,en" });
  if (near) {
    const half = Math.max(0.25, 90 / 2 ** near.zoom);
    const box = [near.lng - half * 1.5, near.lat + half, near.lng + half * 1.5, near.lat - half];
    params.set("viewbox", box.map((v) => v.toFixed(4)).join(","));
  }
  url.search = params.toString();
  return url.toString();
}

export function nominatimPlaces(body: unknown): Place[] {
  const rows = (Array.isArray(body) ? body : []) as { lat: string; lon: string; name?: string; display_name: string }[];
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const name = r.name || r.display_name.split(",")[0];
    const detail = r.display_name.startsWith(`${name}, `) ? r.display_name.slice(name.length + 2) : r.display_name;
    // OSM often has several objects for one place (a square and its metro entrances)
    if (seen.has(name + detail)) return [];
    seen.add(name + detail);
    return [{ lng: Number(r.lon), lat: Number(r.lat), name, detail }];
  });
}
