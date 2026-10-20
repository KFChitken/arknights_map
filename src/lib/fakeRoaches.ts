import { gaussian, mulberry32 } from "./prng";
import { ROACH_COLORS, type Roach } from "./types";

// [name, lng, lat, weight]; weight is roughly the share of players
const CITIES: [string, number, number, number][] = [
  ["上海", 121.47, 31.23, 600],
  ["北京", 116.4, 39.9, 500],
  ["广州", 113.26, 23.13, 350],
  ["深圳", 114.06, 22.54, 350],
  ["杭州", 120.16, 30.27, 300],
  ["成都", 104.07, 30.57, 300],
  ["武汉", 114.31, 30.59, 220],
  ["南京", 118.8, 32.06, 200],
  ["重庆", 106.55, 29.56, 200],
  ["西安", 108.94, 34.34, 180],
  ["苏州", 120.62, 31.3, 150],
  ["长沙", 112.94, 28.23, 150],
  ["天津", 117.2, 39.13, 120],
  ["郑州", 113.62, 34.75, 100],
  ["合肥", 117.23, 31.82, 80],
  ["厦门", 118.09, 24.48, 80],
  ["青岛", 120.38, 36.07, 80],
  ["沈阳", 123.43, 41.8, 80],
  ["福州", 119.3, 26.08, 60],
  ["济南", 117.12, 36.65, 60],
  ["昆明", 102.71, 25.04, 60],
  ["哈尔滨", 126.53, 45.8, 50],
  ["香港", 114.17, 22.32, 100],
  ["台北", 121.56, 25.03, 120],
  ["东京", 139.69, 35.68, 150],
  ["大阪", 135.5, 34.69, 50],
  ["首尔", 126.98, 37.57, 60],
  ["新加坡", 103.82, 1.35, 60],
  ["吉隆坡", 101.69, 3.14, 30],
  ["曼谷", 100.5, 13.75, 20],
  ["悉尼", 151.21, -33.87, 40],
  ["墨尔本", 144.96, -37.81, 30],
  ["温哥华", -123.12, 49.28, 40],
  ["多伦多", -79.38, 43.65, 50],
  ["洛杉矶", -118.24, 34.05, 60],
  ["旧金山", -122.42, 37.77, 40],
  ["西雅图", -122.33, 47.61, 20],
  ["纽约", -74.0, 40.71, 60],
  ["伦敦", -0.13, 51.51, 50],
  ["巴黎", 2.35, 48.86, 25],
  ["柏林", 13.4, 52.52, 20],
  ["莫斯科", 37.62, 55.75, 20],
];

// Scatter some small-town players around inland cities so none land in the sea
const INLAND = ["成都", "武汉", "郑州", "西安", "长沙", "合肥"];

export function generateFakeRoaches(total = 5000, seed = 20261021): Roach[] {
  const rand = mulberry32(seed);
  const totalWeight = CITIES.reduce((s, c) => s + c[3], 0);
  const scattered = Math.round(total * 0.06);
  const urban = total - scattered;
  const roaches: Roach[] = [];
  const color = () => ROACH_COLORS[Math.floor(rand() * ROACH_COLORS.length)];

  for (const [name, lng, lat, w] of CITIES) {
    const n = Math.round((urban * w) / totalWeight);
    const sigma = Math.min(0.03 + w * 0.00015, 0.12);
    for (let i = 0; i < n; i++) {
      roaches.push({
        id: `fake-${name}-${i}`,
        lng: lng + gaussian(rand) * sigma * 1.2,
        lat: lat + gaussian(rand) * sigma,
        color: color(),
      });
    }
  }

  for (let i = 0; i < scattered; i++) {
    const city = CITIES.find((c) => c[0] === INLAND[i % INLAND.length])!;
    roaches.push({
      id: `fake-scatter-${i}`,
      lng: city[1] + gaussian(rand) * 1.2,
      lat: city[2] + gaussian(rand) * 0.9,
      color: color(),
    });
  }
  return roaches;
}
