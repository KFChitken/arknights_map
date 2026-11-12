import type { LngLat } from "./types";

/**
 * Places where no roach may stand: national sites and memorials, in WGS-84 like every stored spot.
 * Putting a roach down or moving it there is refused with OFF_LIMITS_MESSAGE (checkSpot in
 * world/logic.ts, and the map before it asks). The spots the server picks itself skip them:
 * seats by a friend's roach or the fire (pickSeat), 明河都尉's queue (queueSpots); a roach going
 * home to one, from a visit or a ride, stops just outside (outsideOffLimits); and the roaches
 * that stood in one before it was listed move out as the server starts (src/lib/server/offLimits.ts).
 * The places are drawn nowhere, and no message names them.
 */

type Ring = [lng: number, lat: number][];
type Place = { id: string } & ({ ring: Ring } | { at: LngLat; m: number });

/**
 * Each a ring of corners (Beijing's streets run a little off north) or a circle, a little
 * bigger than the site so that its edge is not right on it. The circles are measured from
 * WGS-84 readings of the site, and made wide enough to hold the GCJ-02 ones too where
 * the sources disagreed.
 *
 * The ones after the first eleven are drawn round the sites as OpenStreetMap maps them (WGS-84
 * too): a ring of at most six corners 20–60 m outside the site's outlines, or, where the map has
 * the site only as a building or a point or two, a circle round them, the wider the less it says.
 */
export const OFF_LIMITS: Place[] = [
  // Zhongnanhai: from Wenjin Street down to Chang'an Avenue, Fuyou Street across to Beichang and Nanchang Street
  {
    id: "zhongnanhai",
    ring: [
      [116.3736, 39.9211],
      [116.385, 39.9211],
      [116.3857, 39.9059],
      [116.3742, 39.9056],
    ],
  },
  // Tiananmen Square with the Monument to the People's Heroes, the Chairman Mao Memorial Hall, the Great Hall
  // of the People, the National Museum and Zhengyangmen, and the Tiananmen gate north of Chang'an Avenue
  {
    id: "tiananmen",
    ring: [
      [116.3853, 39.8986],
      [116.3975, 39.8986],
      [116.3975, 39.9071],
      [116.393, 39.9071],
      [116.393, 39.9095],
      [116.3895, 39.9095],
      [116.3895, 39.9071],
      [116.3853, 39.9071],
    ],
  },
  { id: "babaoshan-cemetery", at: { lng: 116.2235, lat: 39.9083 }, m: 400 },
  // the Marco Polo Bridge, Wanping and the Museum of the War of Chinese People's Resistance Against Japanese Aggression
  { id: "lugou-bridge", at: { lng: 116.217, lat: 39.8495 }, m: 650 },
  { id: "nanjing-massacre-memorial", at: { lng: 118.7392, lat: 32.0368 }, m: 500 },
  { id: "yuhuatai", at: { lng: 118.7748, lat: 32.002 }, m: 600 },
  { id: "sun-yat-sen-mausoleum", at: { lng: 118.8488, lat: 32.0612 }, m: 550 },
  { id: "first-cpc-congress-site", at: { lng: 121.4707, lat: 31.2214 }, m: 180 },
  // the former residence, the memorial hall and the square with the statue: the sources put them up to 800 m apart, so it is wide
  { id: "shaoshan", at: { lng: 112.4935, lat: 27.9115 }, m: 1100 },
  { id: "september-18-museum", at: { lng: 123.46, lat: 41.8323 }, m: 450 },
  { id: "unit-731-site", at: { lng: 126.6315, lat: 45.6077 }, m: 750 },

  // ---- martyrs' cemeteries and memorials ----
  // Longhua Martyrs' Cemetery, with the old garrison headquarters and execution ground
  { id: "longhua-martyrs-cemetery", ring: [[121.444, 31.1753], [121.4468, 31.1748], [121.4487, 31.1794], [121.4464, 31.1816], [121.4424, 31.1795], [121.4417, 31.1781]] },
  // Guangzhou Uprising Martyrs' Cemetery
  { id: "guangzhou-uprising-cemetery", ring: [[113.2771, 23.1298], [113.2821, 23.1288], [113.2836, 23.1321], [113.2838, 23.1335], [113.2803, 23.1334], [113.2777, 23.1329]] },
  // Huanghuagang Mausoleum of the 72 Martyrs
  { id: "huanghuagang-cemetery", ring: [[113.2873, 23.1396], [113.2898, 23.1396], [113.2916, 23.1413], [113.2916, 23.1447], [113.2874, 23.1447], [113.2873, 23.1446]] },
  // Gele Mountain Martyrs' Cemetery and the Hongyan memorial hall
  { id: "gele-mountain-martyrs-cemetery", ring: [[106.4365, 29.5737], [106.4427, 29.5732], [106.4427, 29.5745], [106.4422, 29.5752], [106.4377, 29.5754], [106.4364, 29.5741]] },
  // Zhazidong prison
  { id: "zhazidong-prison", at: { lng: 106.4285, lat: 29.5887 }, m: 110 },
  // Baigongguan prison
  { id: "baigongguan-prison", at: { lng: 106.4284, lat: 29.5791 }, m: 140 },
  // North China Military Region Martyrs' Cemetery
  { id: "north-china-martyrs-cemetery", at: { lng: 114.4594, lat: 38.0432 }, m: 300 },
  // Shenyang War to Resist US Aggression and Aid Korea Martyrs' Cemetery
  { id: "shenyang-korean-war-cemetery", ring: [[123.4435, 41.8494], [123.4469, 41.8501], [123.4501, 41.854], [123.4454, 41.8561], [123.4429, 41.8532], [123.4414, 41.8493]] },
  // Memorial of the War to Resist US Aggression and Aid Korea, Dandong, with its tower
  { id: "dandong-korean-war-museum", at: { lng: 124.3595, lat: 40.1171 }, m: 240 },
  // Northeast Martyrs Memorial Hall
  { id: "northeast-martyrs-museum", at: { lng: 126.6368, lat: 45.7642 }, m: 120 },
  // Yang Jingyu Martyr's Cemetery
  { id: "yang-jingyu-cemetery", ring: [[125.9556, 41.7261], [125.9587, 41.7255], [125.9604, 41.7264], [125.9597, 41.7274], [125.9542, 41.7292], [125.9522, 41.7271]] },
  // Langya Mountain: the peak the Five Heroes leapt from, with their memorial tower
  { id: "langya-mountain-peak", at: { lng: 115.1702, lat: 39.1374 }, m: 240 },
  // Langya Mountain: the Five Heroes' exhibition hall
  { id: "langya-mountain-museum", at: { lng: 115.1791, lat: 39.1333 }, m: 120 },
  // Qiu Shaoyun Memorial Hall
  { id: "qiu-shaoyun-memorial", ring: [[106.048, 29.8493], [106.0492, 29.8498], [106.0481, 29.8508], [106.0473, 29.8512], [106.0466, 29.851], [106.0463, 29.85]] },
  // Huang Jiguang Memorial Hall
  { id: "huang-jiguang-memorial", ring: [[104.6798, 31.0367], [104.6805, 31.0364], [104.6812, 31.037], [104.6813, 31.0377], [104.6801, 31.0384], [104.6798, 31.0382]] },
  // Dong Cunrui Martyr's Cemetery, and where he fell
  { id: "dong-cunrui-cemetery", ring: [[117.7211, 41.3192], [117.7218, 41.3191], [117.7256, 41.3207], [117.7254, 41.3245], [117.7225, 41.3244], [117.7209, 41.3195]] },
  // Liu Hulan Memorial Hall
  { id: "liu-hulan-memorial", ring: [[112.1922, 37.391], [112.1924, 37.3911], [112.1934, 37.3947], [112.1913, 37.395], [112.1911, 37.3949], [112.1901, 37.3914]] },
  // Lei Feng Memorial Hall and his tomb
  { id: "lei-feng-memorial", at: { lng: 123.7968, lat: 41.8486 }, m: 140 },

  // ---- sites of the revolution and of the Party's history ----
  // South Lake, Jiaxing: the island where the Red Boat is moored
  { id: "south-lake-island", at: { lng: 120.7559, lat: 30.7575 }, m: 140 },
  // South Lake Revolutionary Memorial Hall
  { id: "south-lake-memorial", ring: [[120.7557, 30.7494], [120.7561, 30.7492], [120.7577, 30.7492], [120.7581, 30.7493], [120.7582, 30.7505], [120.7557, 30.7506]] },
  // the old South Lake Revolutionary Memorial Hall
  { id: "south-lake-old-memorial", at: { lng: 120.7573, lat: 30.7603 }, m: 70 },
  // Jinggangshan Revolutionary Martyrs' Cemetery, with the martyrs' tomb and memorial tower
  { id: "jinggang-martyrs-cemetery", ring: [[114.1623, 26.5738], [114.163, 26.574], [114.1631, 26.5835], [114.16, 26.5827], [114.1592, 26.5821], [114.1569, 26.5773]] },
  // Jinggangshan Revolution Museum
  { id: "jinggang-revolution-museum", at: { lng: 114.1601, lat: 26.5709 }, m: 120 },
  // Zunyi Conference site and memorial hall
  { id: "zunyi-conference-site", ring: [[106.9157, 27.691], [106.9183, 27.6914], [106.9185, 27.6924], [106.9175, 27.6933], [106.9171, 27.6931], [106.9155, 27.6921]] },
  // Yan'an: Baota Hill
  { id: "baota-hill", ring: [[109.487, 36.5877], [109.4951, 36.5891], [109.4955, 36.5908], [109.495, 36.5952], [109.4924, 36.5978], [109.4875, 36.5946]] },
  // Yan'an: Zaoyuan
  { id: "zaoyuan", ring: [[109.4132, 36.6261], [109.4178, 36.6261], [109.4178, 36.6298], [109.4132, 36.6298]] },
  // Yan'an: Yangjialing
  { id: "yangjialing", ring: [[109.4608, 36.617], [109.4634, 36.6181], [109.4668, 36.6202], [109.4668, 36.6214], [109.4638, 36.6208], [109.4601, 36.6192]] },
  // Yan'an: Wangjiaping and the Yan'an Revolutionary Memorial Hall
  { id: "wangjiaping", ring: [[109.4704, 36.6089], [109.4741, 36.606], [109.4763, 36.606], [109.4763, 36.6092], [109.472, 36.6103], [109.4704, 36.6099]] },
  // Xibaipo: the former CPC Central Committee site and memorial hall
  { id: "xibaipo", ring: [[113.9341, 38.3397], [113.9343, 38.3389], [113.9386, 38.3384], [113.9398, 38.3389], [113.9386, 38.3406], [113.934, 38.3407]] },
  // Ruijin: the Yeping sites
  { id: "ruijin-yeping", ring: [[116.0663, 25.9066], [116.0672, 25.9067], [116.0686, 25.9096], [116.0673, 25.9105], [116.0664, 25.9105], [116.0657, 25.9091]] },
  // Ruijin, Shazhouba: the Red Well and the provisional central government sites
  { id: "ruijin-red-well", ring: [[116.0021, 25.8813], [116.0048, 25.8827], [116.0089, 25.8882], [116.0069, 25.8885], [116.0025, 25.8865], [116.0007, 25.8824]] },
  // Ruijin, Shazhouba: the Second National Soviet Congress hall
  { id: "ruijin-second-congress", ring: [[115.9916, 25.8868], [115.9922, 25.8854], [115.9934, 25.8852], [115.9956, 25.886], [115.9928, 25.888], [115.9918, 25.8881]] },
  // Ruijin: the Chinese Soviet Republic memorial park
  { id: "ruijin-soviet-memorial-park", ring: [[116.0119, 25.8737], [116.0122, 25.8747], [116.0118, 25.8783], [116.0106, 25.881], [116.0082, 25.8803], [116.0065, 25.8726]] },
  // Gutian Conference site
  { id: "gutian-conference-site", at: { lng: 116.8226, lat: 25.2209 }, m: 280 },
  // Gutian Conference memorial hall
  { id: "gutian-conference-museum", at: { lng: 116.8182, lat: 25.2248 }, m: 110 },
  // Memorial Hall of the Nanchang Uprising
  { id: "nanchang-uprising-museum", at: { lng: 115.8846, lat: 28.6783 }, m: 130 },
  // Zhou Enlai Memorial Hall
  { id: "zhou-enlai-memorial", at: { lng: 119.1449, lat: 33.5187 }, m: 280 },
  // Zhou Enlai's former residence
  { id: "zhou-enlai-residence", at: { lng: 119.1369, lat: 33.5084 }, m: 90 },
  // Deng Xiaoping's former residence
  { id: "deng-xiaoping-hometown", ring: [[106.6291, 30.5146], [106.6336, 30.5139], [106.6367, 30.527], [106.6351, 30.5311], [106.6337, 30.5314], [106.6293, 30.5228]] },
  // Liu Shaoqi's former residence and memorial hall, Huaminglou
  { id: "liu-shaoqi-hometown", ring: [[112.6363, 28.0373], [112.6395, 28.0336], [112.6457, 28.0363], [112.6449, 28.0414], [112.64, 28.044], [112.637, 28.0418]] },
  // Zhu De's former residence and memorial hall
  { id: "zhu-de-residence", at: { lng: 106.6092, lat: 31.4714 }, m: 350 },
  // Zhu De's birthplace
  { id: "zhu-de-birthplace", at: { lng: 106.5969, lat: 31.4641 }, m: 110 },

  // ---- the wars of invasion: massacres, battles and their memorials ----
  // Pingdingshan Massacre Memorial Hall
  { id: "pingdingshan-massacre-memorial", ring: [[123.9181, 41.8295], [123.9221, 41.83], [123.9236, 41.8333], [123.9232, 41.8359], [123.9223, 41.8359], [123.9166, 41.8302]] },
  // the Chongqing bombing tunnel massacre site
  { id: "chongqing-tunnel-massacre-site", at: { lng: 106.5699, lat: 29.5555 }, m: 100 },
  // Songhu Anti-Japanese War Memorial Hall and park
  { id: "songhu-war-memorial", ring: [[121.4882, 31.4091], [121.4926, 31.4103], [121.492, 31.4117], [121.4909, 31.4128], [121.4892, 31.4132], [121.4867, 31.4123]] },
  // Taierzhuang Battle Memorial Hall
  { id: "taierzhuang-memorial", ring: [[117.7263, 34.5574], [117.7268, 34.5589], [117.7264, 34.5594], [117.7251, 34.5595], [117.7247, 34.559], [117.7244, 34.5577]] },
  // the Pingxing Pass victory site and memorial hall
  { id: "pingxing-pass-victory-site", at: { lng: 113.9673, lat: 39.3434 }, m: 260 },
  // Hundred Regiments Offensive monument and memorial hall
  { id: "hundred-regiments-memorial", at: { lng: 113.5231, lat: 37.8507 }, m: 270 },
  // Lushun Wanzhong Tomb
  { id: "lushun-wanzhong-tomb", at: { lng: 121.2564, lat: 38.8163 }, m: 130 },
  // Lushun Japanese-Russian Prison site
  { id: "lushun-prison", at: { lng: 121.2599, lat: 38.8246 }, m: 140 },
  // Lijixiang comfort station site museum
  { id: "lijixiang-comfort-station", at: { lng: 118.7925, lat: 32.0411 }, m: 80 },

  // ---- the great earthquakes ----
  // Yingxiu: the Xuankou Middle School ruins, the epicentre memorial hall and the victims' cemetery
  { id: "yingxiu-quake-memorial", ring: [[103.4826, 31.057], [103.4871, 31.0565], [103.4884, 31.0571], [103.4878, 31.0579], [103.4861, 31.0589], [103.4826, 31.0584]] },
  // the old Beichuan county town earthquake ruins
  { id: "old-beichuan-quake-ruins", ring: [[104.4509, 31.8198], [104.47, 31.8406], [104.4625, 31.8386], [104.4599, 31.8372], [104.4508, 31.8285], [104.4491, 31.8208]] },
  // the 5·12 Wenchuan Earthquake Memorial Museum, Beichuan
  { id: "beichuan-quake-museum", ring: [[104.4451, 31.8121], [104.4486, 31.8098], [104.4509, 31.8116], [104.4473, 31.8157], [104.4463, 31.8153], [104.4447, 31.8131]] },
  // Tangshan Earthquake Ruins Memorial Park
  { id: "tangshan-quake-memorial-park", ring: [[118.1776, 39.5937], [118.1841, 39.5927], [118.1856, 39.5969], [118.1822, 39.602], [118.1816, 39.6024], [118.1747, 39.5954]] },

  // ---- the Yellow Emperor ----
  // the Mausoleum of the Yellow Emperor and its temple
  { id: "yellow-emperor-mausoleum", ring: [[109.2609, 35.5831], [109.2734, 35.5822], [109.2744, 35.585], [109.27, 35.59], [109.2644, 35.5925], [109.2561, 35.59]] },
];

/** What a player is told who picks a spot in one: the same everywhere, naming no place */
export const OFF_LIMITS_MESSAGE = "这里不能放蟑螂，换个地方吧。";

const M_PER_DEG = 111_320;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Metres between two points, flat-earth: plenty within a few kilometres */
function metres(a: LngLat, b: LngLat) {
  const dx = (a.lng - b.lng) * M_PER_DEG * Math.cos(rad((a.lat + b.lat) / 2));
  return Math.hypot(dx, (a.lat - b.lat) * M_PER_DEG);
}

/** A point some metres from p along a compass bearing */
function offset(p: LngLat, deg: number, m: number): LngLat {
  return {
    lng: p.lng + (m * Math.sin(rad(deg))) / (M_PER_DEG * Math.cos(rad(p.lat))),
    lat: p.lat + (m * Math.cos(rad(deg))) / M_PER_DEG,
  };
}

/** Even-odd test against a ring of corners */
function inRing(ring: Ring, p: LngLat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Each place's middle and how far from it its farthest point is: a quick test first, and what the server looks through */
export const OFF_LIMITS_REACH: { id: string; at: LngLat; m: number }[] = OFF_LIMITS.map((p) => {
  if ("at" in p) return { id: p.id, at: p.at, m: p.m };
  const at = {
    lng: p.ring.reduce((s, [lng]) => s + lng, 0) / p.ring.length,
    lat: p.ring.reduce((s, [, lat]) => s + lat, 0) / p.ring.length,
  };
  return { id: p.id, at, m: Math.max(...p.ring.map(([lng, lat]) => metres(at, { lng, lat }))) };
});

// a box around each, in degrees, so most points are let through without any arithmetic
const BOXES = OFF_LIMITS_REACH.map(({ at, m }) => {
  const dLat = (m / M_PER_DEG) * 1.01;
  const dLng = dLat / Math.cos(rad(at.lat));
  return { w: at.lng - dLng, e: at.lng + dLng, s: at.lat - dLat, n: at.lat + dLat };
});

/** The id of the place p is in, or null */
export function offLimitsAt(p: LngLat): string | null {
  for (const [i, place] of OFF_LIMITS.entries()) {
    const b = BOXES[i];
    if (p.lng < b.w || p.lng > b.e || p.lat < b.s || p.lat > b.n) continue;
    if ("ring" in place ? inRing(place.ring, p) : metres(place.at, p) < place.m) return place.id;
  }
  return null;
}

export const isOffLimits = (p: LngLat) => offLimitsAt(p) !== null;

/** How finely, and how far at most, the way out is looked for: every place is far smaller */
const STEP_M = 10;
const MAX_M = 4000;

/**
 * Where a roach that would stand at p stands instead: p itself where it may, else out of
 * the place the shortest way (of 36, a tie picked at random), and then on between `past`
 * metres more, a little to either side, so that roaches moved out of one place spread out
 * around it instead of lining its edge.
 */
export function outsideOffLimits(p: LngLat, random: () => number = Math.random, past: [number, number] = [60, 300]): LngLat {
  if (!isOffLimits(p)) return p;
  let edge = MAX_M;
  let ways: number[] = [];
  for (let deg = 0; deg < 360; deg += 10) {
    for (let m = STEP_M; m <= edge; m += STEP_M) {
      if (isOffLimits(offset(p, deg, m))) continue;
      if (m < edge) ways = [];
      edge = m;
      ways.push(deg);
      break;
    }
  }
  const way = ways.length ? ways[Math.floor(random() * ways.length)] : 0;
  const deg = way + (random() * 2 - 1) * 10;
  // on past the edge; another place further along the way is walked through the same way
  for (let m = edge + past[0] + random() * (past[1] - past[0]); m < edge + MAX_M; m += STEP_M) {
    const q = offset(p, deg, m);
    if (!isOffLimits(q)) return q;
  }
  return offset(p, way, edge);
}
