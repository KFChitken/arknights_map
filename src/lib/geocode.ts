import { amapPlugins, type AMapNS } from "./amap";
import { amapConfigured } from "./basemap";
import { fromGcj, toGcj } from "./coords";
import { distanceKm } from "./geo";
import type { Basemap, LngLat, MapView } from "./types";

/** A search hit, always in WGS-84. */
export type Place = LngLat & { name: string; detail: string };

/** osm: some places came from OpenStreetMap, which then needs crediting */
export type PlaceResults = { places: Place[]; osm: boolean };

/**
 * Suggestions while typing: Amap input tips on the Amap basemap, Photon (an
 * OSM geocoder built for search-as-you-type) elsewhere or when Amap finds nothing.
 * near, when given, ranks places around that point first.
 */
export async function suggestPlaces(query: string, basemap: Basemap, near?: LngLat): Promise<PlaceResults> {
  const q = query.trim();
  if (!q) return { places: [], osm: false };
  if (basemap === "amap" && amapConfigured) {
    try {
      const places = await amapTips(q);
      if (places.length) return { places, osm: false };
    } catch (e) {
      console.warn("Amap tips failed, trying OSM", e);
    }
  }
  return { places: await photonSearch(q, near), osm: true };
}

/**
 * Full search when the player presses Enter. Uses the OpenStreetMap Nominatim
 * geocoder, which also knows Chinese names of places abroad; on the Amap
 * basemap, Amap's POI search comes first and Nominatim fills in places abroad.
 * near, when given, is the map view: places around it come first, so
 * 人民广场 seen over Shanghai is not the one in Kuala Lumpur.
 */
export async function searchPlaces(query: string, basemap: Basemap, near?: MapView): Promise<PlaceResults> {
  const q = query.trim();
  if (!q) return { places: [], osm: false };
  if (!(basemap === "amap" && amapConfigured)) return { places: await nominatimSearch(q, near), osm: true };
  const [amap, osm] = await Promise.allSettled([amapSearch(q, near), nominatimSearch(q, near)]);
  if (amap.status === "rejected") console.warn("Amap search failed", amap.reason);
  if (amap.status === "rejected" && osm.status === "rejected") throw osm.reason;
  const fromAmap = amap.status === "fulfilled" ? amap.value.slice(0, 6) : [];
  // skip OSM hits that are the same place Amap already found
  const fromOsm = (osm.status === "fulfilled" ? osm.value : [])
    .filter((o) => !fromAmap.some((a) => a.name === o.name && distanceKm(a, o) < 0.5))
    .slice(0, fromAmap.length ? 4 : 8);
  return { places: [...fromAmap, ...fromOsm], osm: fromOsm.length > 0 };
}

async function amapTips(q: string): Promise<Place[]> {
  const AMap = await amapPlugins("AMap.AutoComplete");
  const tips = await new Promise<AMapNS[]>((resolve, reject) => {
    new AMap.AutoComplete().search(q, (status: string, result: AMapNS) => {
      if (status === "complete") resolve(result?.tips ?? []);
      else if (status === "no_data") resolve([]);
      else reject(new Error(String(result)));
    });
  });
  // tips without a location are query suggestions, not places
  return tips
    .filter((t) => t.location?.lng)
    .map((t) => ({
      ...fromGcj(t.location.lng, t.location.lat),
      name: t.name,
      detail: [t.district, typeof t.address === "string" ? t.address : ""].filter(Boolean).join(" · "),
    }));
}

/** Within this many metres of the map center Amap looks first (its limit is 50 km). */
const AMAP_NEARBY_M = 50_000;

/** Run one Amap place search and hand back its POIs. */
function amapPois(run: (callback: (status: string, result: AMapNS) => void) => void) {
  return new Promise<AMapNS[]>((resolve, reject) =>
    run((status, result) => {
      if (status === "complete") resolve(result?.poiList?.pois ?? []);
      else if (status === "no_data") resolve([]);
      else reject(new Error(String(result)));
    }),
  );
}

async function amapSearch(q: string, near?: LngLat): Promise<Place[]> {
  const AMap = await amapPlugins("AMap.PlaceSearch", "AMap.Geocoder");
  const search = new AMap.PlaceSearch({ pageSize: 8, pageIndex: 1, extensions: "base" });
  let pois = near ? await amapPois((done) => search.searchNearBy(q, toGcj(near), AMAP_NEARBY_M, done)) : [];
  if (!pois.length) pois = await amapPois((done) => search.search(q, done));
  const places: Place[] = pois
    .filter((p) => p.location)
    .map((p) => ({
      ...fromGcj(p.location.lng, p.location.lat),
      name: p.name,
      detail: [p.pname, p.cityname, p.adname, typeof p.address === "string" ? p.address : ""]
        .filter((s, i, a) => s && a.indexOf(s) === i)
        .join(" · "),
    }));
  if (places.length) return places;
  // Plain addresses and districts ("上海市徐汇区") are better served by the geocoder
  const codes = await new Promise<AMapNS[]>((resolve) => {
    new AMap.Geocoder().getLocation(q, (status: string, result: AMapNS) =>
      resolve(status === "complete" ? (result?.geocodes ?? []) : []),
    );
  });
  return codes
    .filter((c) => c.location)
    .map((c) => ({
      ...fromGcj(c.location.lng, c.location.lat),
      name: c.formattedAddress,
      detail: c.level ?? "",
    }));
}

// Nominatim's usage policy allows at most one request per second and no search-as-you-type
let lastNominatim = 0;

async function nominatimSearch(q: string, near?: MapView): Promise<Place[]> {
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "8",
    "accept-language": "zh-CN,zh,en",
  });
  if (near) {
    // a preferred box around what the map shows; places outside still come, just later
    const half = Math.max(0.25, 90 / 2 ** near.zoom);
    const box = [near.lng - half * 1.5, near.lat + half, near.lng + half * 1.5, near.lat - half];
    params.set("viewbox", box.map((v) => v.toFixed(4)).join(","));
  }
  url.search = params.toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
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

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Partial<Record<"name" | "street" | "district" | "city" | "county" | "state" | "country", string>>;
};

async function photonSearch(q: string, near?: LngLat): Promise<Place[]> {
  const url = new URL("https://photon.komoot.io/api/");
  // "default" keeps local names (中文 in China) instead of following the browser language
  const params = new URLSearchParams({ q, limit: "8", lang: "default" });
  if (near) {
    params.set("lat", near.lat.toFixed(4));
    params.set("lon", near.lng.toFixed(4));
  }
  url.search = params.toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const { features } = (await res.json()) as { features: PhotonFeature[] };
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
