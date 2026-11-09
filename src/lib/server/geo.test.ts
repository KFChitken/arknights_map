import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/geo/route";
import { fromGcj } from "../coords";
import { amapSearchToday, forgetGeo, GEO_BUSY, GEO_PER_ADDRESS, geoSearch, NOMINATIM_WAITING } from "./geo";
import { inMainland } from "./region";
import { forgetSignals, recent } from "./signals";

// a China Telecom address in Guangzhou, and one from the documentation ranges, which is nowhere
const MAINLAND = "202.96.128.86";
const ABROAD = "203.0.113.7";
const KEY = "test-webservice-key";
const SHANGHAI = { lng: 121.47, lat: 31.23, zoom: 11 };
const TOKYO = { lng: 139.77, lat: 35.7, zoom: 11 };

const photonBody = (name: string) => ({
  features: [{ geometry: { coordinates: [121.4459, 31.2232] }, properties: { name, city: "上海市", country: "中国" } }],
});
const nominatimBody = (name: string) => [{ lat: "35.6984", lon: "139.7731", name, display_name: `${name}, 千代田区, 东京都, 日本` }];
const amapPoi = (name: string) => ({ name, location: "121.449700,31.220500", pname: "上海市", cityname: "上海市", adname: "静安区", address: [] });

/**
 * Stand-ins for OpenStreetMap and 高德: they answer every ask and keep what they were asked.
 * amap: what 高德's place search says ("pois", "none" or "out").
 */
function services(amap: "pois" | "none" | "out" = "pois") {
  const asked: { url: string; at: number; agent: string }[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    asked.push({ url: String(url), at: Date.now(), agent: new Headers(init?.headers).get("user-agent") ?? "" });
    const q = u.searchParams.get("q") ?? u.searchParams.get("keywords") ?? u.searchParams.get("address") ?? "";
    if (u.hostname === "restapi.amap.com") {
      if (u.pathname.includes("geocode")) return Response.json({ status: "1", info: "OK", geocodes: [{ formatted_address: `上海市${q}`, location: "121.437,31.188", level: "区县" }] });
      if (amap === "out") return Response.json({ status: "0", info: "USER_DAILY_QUERY_OVER_LIMIT", infocode: "10044" });
      return Response.json({ status: "1", info: "OK", count: amap === "pois" ? "1" : "0", pois: amap === "pois" ? [amapPoi(q)] : [] });
    }
    return Response.json(u.hostname.includes("photon") ? photonBody(q) : nominatimBody(q));
  }) as typeof fetch;
  const of = (host: string) => asked.filter((a) => new URL(a.url).hostname === host);
  return { asked, fetcher, amap: () => of("restapi.amap.com"), nominatim: () => of("nominatim.openstreetmap.org") };
}

const post = (address: string, body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/geo", {
      method: "POST",
      headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json", "x-forwarded-for": address },
      body: JSON.stringify(body),
    }),
    undefined,
  );

beforeEach(() => {
  forgetGeo();
  forgetSignals();
  vi.stubEnv("AMAP_WEBSERVICE_KEY", KEY);
  vi.stubEnv("AMAP_SEARCH_DAILY", "150");
  // 高德's three a second and Nominatim's one: no real waiting in the tests
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Run asks while the clock moves on, so the turns they wait for come */
async function run<T>(go: () => Promise<T>): Promise<T> {
  const p = go();
  // a refusal is looked at by the test once the clock has moved on
  p.catch(() => {});
  await vi.advanceTimersByTimeAsync(20_000);
  return p;
}

describe("place search through our server (/api/geo)", () => {
  it("answers visitors from mainland China only, so it is nobody's free geocoder", async () => {
    vi.useRealTimers();
    expect(inMainland(MAINLAND)).toBe(true);
    expect(inMainland(ABROAD)).toBe(false);
    const { asked, fetcher } = services();
    vi.stubGlobal("fetch", fetcher);
    expect((await post(ABROAD, { kind: "suggest", q: "静安寺" })).status).toBe(403);
    const home = await post(MAINLAND, { kind: "suggest", q: "静安寺", near: SHANGHAI });
    expect(home.status).toBe(200);
    expect(await home.json()).toEqual({ places: [{ lng: 121.4459, lat: 31.2232, name: "静安寺", detail: "上海市 · 中国" }], osm: true });
    // typing asks Photon only, and says who is asking, with nobody's email
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toContain("photon.komoot.io");
    expect(asked[0].agent).toBe("zhoupmap.com place search (+https://zhoupmap.com)");
    expect((await post(MAINLAND, { kind: "lookup", q: "静安寺" })).status).toBe(400);
  });

  it("on 搜索 puts 高德's places first, around the map's center in China, then Nominatim's", async () => {
    const s = services();
    const found = await run(() => geoSearch(MAINLAND, { kind: "search", q: "静安寺", near: SHANGHAI }, s.fetcher));
    const [amapAsk] = s.amap();
    expect(new URL(amapAsk.url).pathname).toBe("/v3/place/around");
    expect(new URL(amapAsk.url).searchParams.get("radius")).toBe("50000");
    expect(found.places[0]).toEqual({ ...fromGcj(121.4497, 31.2205), name: "静安寺", detail: "上海市 · 静安区" });
    expect(found.places[1]).toMatchObject({ name: "静安寺", detail: "千代田区, 东京都, 日本" });
    expect(found.osm).toBe(true);
    // the map far from China, or not close in: by keyword
    await run(() => geoSearch(MAINLAND, { kind: "search", q: "秋叶原", near: TOKYO }, s.fetcher));
    expect(new URL(s.amap()[1].url).pathname).toBe("/v3/place/text");
  });

  it("finds plain addresses with 高德's geocoder when its places have none, which does not count against the day's share", async () => {
    const s = services("none");
    const found = await run(() => geoSearch(MAINLAND, { kind: "search", q: "徐汇区" }, s.fetcher));
    expect(s.amap().map((a) => new URL(a.url).pathname)).toEqual(["/v3/place/text", "/v3/geocode/geo"]);
    expect(found.places[0]).toMatchObject({ name: "上海市徐汇区", detail: "区县" });
    expect(amapSearchToday().used).toBe(1);
  });

  it("spends at most the day's share of 高德, then answers from OpenStreetMap only", async () => {
    vi.stubEnv("AMAP_SEARCH_DAILY", "2");
    const s = services();
    for (const q of ["静安寺", "外滩", "豫园"]) await run(() => geoSearch(`202.96.128.${q.length + 10}`, { kind: "search", q }, s.fetcher));
    expect(s.amap()).toHaveLength(2);
    expect(s.nominatim()).toHaveLength(3);
    expect(amapSearchToday()).toMatchObject({ used: 2, daily: 2, out: null });
    // a new day (Beijing time), a new share
    vi.setSystemTime(Date.now() + 24 * 3600_000);
    await run(() => geoSearch(MAINLAND, { kind: "search", q: "新天地" }, s.fetcher));
    expect(s.amap()).toHaveLength(3);
  });

  it("stops asking 高德 for the day once it says the allowance is used up, and tells the site's checks", async () => {
    const s = services("out");
    const found = await run(() => geoSearch(MAINLAND, { kind: "search", q: "静安寺" }, s.fetcher));
    expect(found.places).toHaveLength(1);
    expect(amapSearchToday().out).toBe("USER_DAILY_QUERY_OVER_LIMIT");
    expect(recent("map", 60_000).map((r) => r.code)).toEqual(["amap:search:USER_DAILY_QUERY_OVER_LIMIT"]);
    await run(() => geoSearch(MAINLAND, { kind: "search", q: "外滩" }, s.fetcher));
    expect(s.amap()).toHaveLength(1);
  });

  it("without 高德's web service key searches OpenStreetMap only", async () => {
    vi.stubEnv("AMAP_WEBSERVICE_KEY", "");
    const s = services();
    await run(() => geoSearch(MAINLAND, { kind: "search", q: "静安寺" }, s.fetcher));
    expect(s.amap()).toHaveLength(0);
  });

  it("keeps what OpenStreetMap found for a day, from anyone, but never 高德's places (its terms, 3.5)", async () => {
    const s = services();
    const first = await run(() => geoSearch(MAINLAND, { kind: "search", q: "人民广场" }, s.fetcher));
    expect(first.amap).toBe(true);
    await run(() => geoSearch("202.96.128.87", { kind: "search", q: "人民广场" }, s.fetcher));
    // 高德 asked again; Nominatim's answer kept
    expect(s.amap()).toHaveLength(2);
    expect(s.nominatim()).toHaveLength(1);
    // typing is OpenStreetMap's alone: kept whole
    await run(() => geoSearch(MAINLAND, { kind: "suggest", q: "人民广场", near: SHANGHAI }, s.fetcher));
    await run(() => geoSearch("202.96.128.87", { kind: "suggest", q: "人民广场", near: SHANGHAI }, s.fetcher));
    expect(s.asked.filter((a) => a.url.includes("photon.komoot.io"))).toHaveLength(1);
  });

  it("keeps a search whole when 高德 had nothing in it", async () => {
    vi.stubEnv("AMAP_WEBSERVICE_KEY", "");
    const s = services();
    const first = await run(() => geoSearch(MAINLAND, { kind: "search", q: "外滩" }, s.fetcher));
    const again = await run(() => geoSearch("202.96.128.88", { kind: "search", q: "外滩" }, s.fetcher));
    expect(again).toEqual(first);
    expect(first.amap).toBe(false);
    expect(s.asked).toHaveLength(1);
  });

  it(`takes ${GEO_PER_ADDRESS} asks a minute from one address`, async () => {
    const s = services();
    for (let i = 0; i < GEO_PER_ADDRESS; i++) await geoSearch("202.96.128.90", { kind: "suggest", q: `地点${i}` }, s.fetcher);
    await expect(geoSearch("202.96.128.90", { kind: "suggest", q: "再一个" }, s.fetcher)).rejects.toMatchObject({ status: 429, message: GEO_BUSY });
    // another address is not held up
    await expect(geoSearch("202.96.128.91", { kind: "suggest", q: "再一个" }, s.fetcher)).resolves.toMatchObject({ places: [{ name: "再一个" }] });
  });

  it(`asks Nominatim once a second for the whole site, and turns away more than ${NOMINATIM_WAITING} waiting`, async () => {
    vi.stubEnv("AMAP_WEBSERVICE_KEY", "");
    const s = services();
    const asks = Array.from({ length: NOMINATIM_WAITING + 2 }, (_, i) => geoSearch(`202.96.128.${100 + i}`, { kind: "search", q: `秋叶原${i}` }, s.fetcher));
    const results = await run(() => Promise.allSettled(asks));
    expect(results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.status)).toEqual([429]);
    const times = s.nominatim().map((a) => a.at);
    expect(times).toHaveLength(NOMINATIM_WAITING + 1);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1000);
  });

  it("says only that it failed, never the words searched nor 高德's key", async () => {
    const said: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(" ")));
    const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    await expect(run(() => geoSearch(MAINLAND, { kind: "suggest", q: "静安寺附近的家" }, down))).rejects.toMatchObject({ status: 502 });
    await expect(run(() => geoSearch(MAINLAND, { kind: "search", q: "静安寺附近的家" }, down))).rejects.toMatchObject({ status: 502 });
    const all = said.join("\n");
    expect(all).not.toContain("静安寺");
    expect(all).not.toContain(KEY);
    expect(all).toContain("HTTP503");
  });
});
