/**
 * What a page downloads, before and after text moved into src/i18n: the JavaScript
 * each page loads (from a build's .next/app-build-manifest.json) and the script with
 * its words (src/app/i18n), raw and gzipped as the server sends them.
 *
 *   node scripts/i18n/size.mts [--next .next] [--base path/to/other/.next] [--json out.json]
 *
 * Run `npx next build` first. With --base, it compares two builds: say one of main,
 * made in a git worktree, and this one.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const PAGES = ["/page", "/privacy/page", "/admin/page"];

type Size = { raw: number; gzip: number };
export type Sizes = { pages: Record<string, Size>; words: Record<string, Size> };

const sizeOf = (b: Buffer): Size => ({ raw: b.length, gzip: gzipSync(b, { level: 9 }).length });
const add = (a: Size, b: Size): Size => ({ raw: a.raw + b.raw, gzip: a.gzip + b.gzip });

/** Sizes in a build; the words come from the source at the build's root, as its server would send them */
export async function sizes(next: string): Promise<Sizes> {
  const manifest = JSON.parse(readFileSync(join(next, "app-build-manifest.json"), "utf8")) as { pages: Record<string, string[]> };
  const pages: Record<string, Size> = {};
  for (const page of PAGES) {
    const files = (manifest.pages[page] ?? []).filter((f) => f.endsWith(".js"));
    pages[page] = files.map((f) => sizeOf(readFileSync(join(next, f)))).reduce(add, { raw: 0, gzip: 0 });
  }
  const words: Record<string, Size> = {};
  const src = resolve(next, "..", "src/i18n");
  if (existsSync(join(src, "words.ts"))) {
    const load = (f: string) => import(pathToFileURL(join(src, f)).href);
    const { zh } = await load("zh.ts");
    const { en } = await load("en.ts");
    const { fill } = await load("core.ts");
    const { wordsBody } = await load("words.ts");
    words.zh = sizeOf(Buffer.from(wordsBody("zh", zh)));
    words.en = sizeOf(Buffer.from(wordsBody("en", fill(zh, en))));
  }
  return { pages, words };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const delta = (a: number, b: number) => `${b - a >= 0 ? "+" : ""}${((b - a) / 1024).toFixed(1)} KB`;

async function main(argv: string[]) {
  const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const now = await sizes(opt("--next") ?? ".next");
  const basePath = opt("--base");
  const base = basePath ? await sizes(basePath) : null;
  const out = opt("--json");
  if (out) writeFileSync(out, JSON.stringify({ base, now }, null, 1));
  const rows: string[] = [];
  const zero = { raw: 0, gzip: 0 };
  for (const page of PAGES) {
    const b = base?.pages[page];
    const n = now.pages[page];
    rows.push(`${page.padEnd(14)} JS ${kb(n.gzip).padStart(9)} gzip${b ? `  (was ${kb(b.gzip)}, ${delta(b.gzip, n.gzip)}; raw ${delta(b.raw, n.raw)})` : ""}`);
  }
  for (const lang of Object.keys(now.words)) {
    const b = base?.words[lang] ?? zero;
    const n = now.words[lang];
    rows.push(`words ${lang.padEnd(8)} ${kb(n.gzip).padStart(9)} gzip${base ? `  (was ${kb(b.gzip)}, ${delta(b.gzip, n.gzip)}; raw ${kb(n.raw)})` : `  (raw ${kb(n.raw)})`}`);
  }
  if (base) {
    const total = (s: Sizes) => add(s.pages["/page"], s.words.zh ?? zero);
    rows.push(`map page + its Chinese words: ${kb(total(now).gzip)} gzip (was ${kb(total(base).gzip)}, ${delta(total(base).gzip, total(now).gzip)})`);
  }
  console.log(rows.join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
