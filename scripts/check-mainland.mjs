// Can people in mainland China open the site? Asks Globalping (api.globalping.io: free, no
// account) to fetch it from probes in mainland China, with Hong Kong as a control, and exits 1
// when most of either cannot. GitHub runs it every day (.github/workflows/mainland-check.yml)
// and emails whoever last changed that schedule when it fails.
// usage: node scripts/check-mainland.mjs [host]
import fs from "node:fs";

const HOST = process.argv[2] || "zhoupmap.com";
const API = "https://api.globalping.io/v1/measurements";
const PLACES = [
  { name: "内地", country: "CN", limit: 8 },
  { name: "香港", country: "HK", limit: 3 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One fetch of the home page from every probe Globalping gives us in those places. */
async function measure() {
  const res = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "http",
      target: HOST,
      locations: PLACES.map(({ country, limit }) => ({ country, limit })),
      measurementOptions: { protocol: "HTTPS", request: { path: "/", method: "HEAD" } },
    }),
  });
  if (!res.ok) throw new Error(`Globalping refused the test: HTTP ${res.status} ${await res.text()}`);
  const { id } = await res.json();
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const m = await (await fetch(`${API}/${id}`)).json();
    if (m.status !== "in-progress") return m.results;
  }
  throw new Error("Globalping did not finish the test within two minutes");
}

/** Any answer below 500 means the page reached the probe; a timeout or reset means it did not. */
const opened = (r) => r.result.status === "finished" && r.result.statusCode < 500;

function tally(results) {
  return PLACES.map((place) => {
    const here = results.filter((r) => r.probe.country === place.country);
    return { ...place, here, ok: here.filter(opened).length };
  });
}

/** Most probes could not open it; a few failing is ordinary network noise. */
const down = (p) => p.here.length > 0 && p.ok * 2 < p.here.length;

let places = tally(await measure());
// A bad minute on Globalping's side should not wake anyone: ask once more before calling it down
if (places.some(down)) {
  await sleep(60_000);
  places = tally(await measure());
}

const lines = [`## ${HOST} 能不能打开（${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC）`, ""];
for (const p of places) {
  lines.push(`**${p.name}**：${p.here.length ? `${p.ok}/${p.here.length} 个节点能打开` : "这次没分到节点"}`, "");
  for (const r of p.here) {
    const what = opened(r)
      ? `能打开（HTTP ${r.result.statusCode}，${r.result.timings?.total ?? "?"} 毫秒）`
      : `打不开：${(r.result.rawOutput || r.result.status).split("\n")[0]}`;
    lines.push(`- ${r.probe.city}，${r.probe.network}：${what}`);
  }
  lines.push("");
}

const [mainland, hongKong] = places;
let verdict = "内地和香港都能打开。";
if (down(hongKong)) {
  verdict = "香港也打不开，网站可能整个停了：先看服务器还在不在、容器有没有在跑。";
} else if (down(mainland)) {
  verdict =
    "内地打不开、香港能打开，多半是服务器 IP 在内地被封了。用 itdog 测「IP:443」确认（https://www.itdog.cn/tcping/），确认后在腾讯云换公网 IP、改 DNSPod 的两条解析。";
} else if (!mainland.here.length) {
  verdict = "这次没分到内地节点，今天没测成；明天会再测。";
}
lines.push(`**结论**：${verdict}`);

const text = lines.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
if (!mainland.here.length) console.log("::warning::这次没分到内地节点");
process.exit(down(mainland) || down(hongKong) ? 1 : 0);
