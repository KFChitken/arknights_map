import { fromGcj, shifted, toGcj } from "./coords";
import type { Place } from "./geocode";
import type { LngLat } from "./types";

/*
 * Typing suggestions for visitors from mainland China from 腾讯位置服务's 关键词输入提示
 * (https://lbs.qq.com/service/webService/webServiceGuide/search/webServiceSuggestion), asked by
 * the browser itself: Tencent answers from mainland China, our server is in Hong Kong. Tencent
 * checks the page's address against the key's list of sites, so the key is in the page. The
 * service sends no CORS headers, so the answer comes as JSONP.
 */

const KEY = process.env.NEXT_PUBLIC_TENCENT_KEY ?? "";
const URL_BASE = "https://apis.map.qq.com/ws/place/v1/suggestion";
/** After this long without an answer the page asks OpenStreetMap instead */
export const TENCENT_WAIT_MS = 3000;
/** How long a page leaves Tencent alone once it says the key cannot be used */
export const TENCENT_REST_MS = 60 * 60_000;

/**
 * Tencent's answers that say the key itself cannot be used for now: not allowed from this site
 * (110), a key or signature problem (111, 112, 113, 190, 199, 301, 311) or the day's calls used up
 * (121). Asking again will not help, and the site's checks should hear of it. Other refusals (120:
 * too many this second, 3xx: a question it did not like, 5xx: its own trouble) are for one ask only.
 */
const KEY_TROUBLE = new Set([110, 111, 112, 113, 121, 190, 199, 301, 311]);

export const keyTrouble = (status: number) => KEY_TROUBLE.has(status);

export function tencentUrl(q: string, near: LngLat | undefined, callback: string, key = KEY) {
  const params = new URLSearchParams({
    keyword: q,
    key,
    // cities and districts too: plenty of players put their roach in a city, not at a door
    get_ad: "1",
    // without the street's city and district, which are shown beside it
    address_format: "short",
    page_size: "8",
    page_index: "1",
    output: "jsonp",
    callback,
  });
  if (near) {
    // Tencent ranks places near this spot first; it takes the spot as drawn on Chinese maps
    const [lng, lat] = toGcj(near);
    params.set("location", `${lat.toFixed(6)},${lng.toFixed(6)}`);
  }
  return `${URL_BASE}?${params}`;
}

type TencentTip = {
  title?: string;
  address?: string;
  province?: string;
  city?: string;
  district?: string;
  adcode?: number;
  location?: { lat?: number; lng?: number };
};

/** Tencent's answer: its status (0 is fine) and the places, in WGS-84 */
export function tencentPlaces(body: unknown): { status: number; places: Place[] } {
  const { status, data } = (body ?? {}) as { status?: unknown; data?: unknown };
  if (typeof status !== "number") return { status: -1, places: [] };
  const seen = new Set<string>();
  const places = (Array.isArray(data) ? (data as TencentTip[]) : []).flatMap((t) => {
    const name = String(t.title ?? "").trim();
    const { lng, lat } = t.location ?? {};
    if (!name || typeof lng !== "number" || typeof lat !== "number") return [];
    const detail = [t.province, t.city, t.district, t.address]
      .filter((s): s is string => typeof s === "string" && s.length > 0 && s !== name)
      .filter((s, i, a) => a.indexOf(s) === i)
      .join(" · ");
    if (seen.has(name + detail)) return [];
    seen.add(name + detail);
    // Tencent gives spots in Taiwan (区划代码 71xxxx) as they are, elsewhere as drawn on Chinese maps
    const spot = String(t.adcode ?? "").startsWith("71") ? { lng, lat } : fromGcj(lng, lat);
    return [{ ...spot, name, detail }];
  });
  return { status, places };
}

let restUntil = 0;
let calls = 0;

/** Whether this page may ask Tencent: a key is built in and Tencent has not turned it away lately */
export const tencentReady = (now = Date.now()) => KEY !== "" && now >= restUntil;

/**
 * Suggestions from Tencent, or null when there are none to give: no key, resting after a refusal,
 * the map looking at somewhere outside China, no answer within TENCENT_WAIT_MS, or a refusal. onKeyTrouble hears Tencent's status when the key
 * itself was turned away, after which this page leaves Tencent alone for TENCENT_REST_MS.
 */
export async function tencentTips(q: string, near: LngLat | undefined, onKeyTrouble: (status: number) => void): Promise<Place[] | null> {
  // Tencent knows China's places only: over Tokyo, 秋叶原 would bring shops of that name in China
  if (!tencentReady() || (near && !shifted(near))) return null;
  const body = await jsonp((callback) => tencentUrl(q, near, callback), TENCENT_WAIT_MS);
  if (body === null) return null;
  const { status, places } = tencentPlaces(body);
  if (status === 0) return places;
  if (keyTrouble(status)) {
    restUntil = Date.now() + TENCENT_REST_MS;
    onKeyTrouble(status);
  }
  return null;
}

/**
 * A JSONP ask: the answer, or null when the script failed or took longer than ms. Tencent's
 * answer reads `name&&name({...})`, so one arriving after its function is gone does nothing.
 */
function jsonp(url: (callback: string) => string, ms: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    const name = `__zhoupTips${++calls}`;
    const slot = window as unknown as Record<string, unknown>;
    const script = document.createElement("script");
    let timer = 0;
    const finish = (body: unknown | null) => {
      window.clearTimeout(timer);
      delete slot[name];
      script.remove();
      resolve(body);
    };
    slot[name] = (body: unknown) => finish(body ?? {});
    script.onerror = () => finish(null);
    timer = window.setTimeout(() => finish(null), ms);
    script.src = url(name);
    script.async = true;
    document.head.appendChild(script);
  });
}
