/**
 * The word-for-word check: after text has moved from the code into src/i18n/zh.ts,
 * every piece of Chinese the code had at <base> must still read exactly the same.
 *
 *   node scripts/i18n/verify.mts --base origin/main [--report out.json]
 *
 * It scans the code at <base> (scan.mts) and now, and reads zh.ts. Each piece of
 * text at <base> must be either still in its file as it was, or in zh.ts with the
 * same words, punctuation and spaces, and read from that same file through T. A
 * template's ${…} and a dictionary's {name} both count as a blank, in order.
 * Every word in zh.ts must also have been in the code at <base>, or be a whole
 * sentence put together from pieces that were (scripts/i18n/joins.json), so
 * nothing new is said. It checks only what was said, not how the code says it:
 * the tests and the screenshots (screens.mjs) check the rest.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { scanSource, sourceFiles, type Hit } from "./scan.mts";

type Value = string | readonly Value[] | { readonly [k: string]: Value };

/** A piece of text with its blanks numbered in order: 「第 {0} 次」 */
export const normalize = (text: string) => {
  let i = 0;
  return text.replace(/\{[^{}]+\}/g, () => `{${i++}}`);
};

/** Every string in a dictionary value, a Counted's forms included */
export function strings(v: Value | undefined): string[] {
  if (v === undefined) return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  return Object.values(v as Record<string, Value>).flatMap(strings);
}

/** The value at a dotted path */
export function at(dict: Value, path: string[]): Value | undefined {
  let v: Value | undefined = dict;
  for (const k of path) v = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Value>)[k] : undefined;
  return v;
}

/**
 * What a file reads from T: the longest T.a.b.c paths in it (T.a.b[x] reads all of
 * T.a.b). Only T imported from "@/i18n" counts.
 */
export function readsOf(file: string, source: string): string[][] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imported = sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === "@/i18n" &&
      s.importClause?.namedBindings &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === "T"),
  );
  if (!imported) return [];
  const paths: string[][] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "T" && !ts.isImportSpecifier(node.parent)) {
      const path: string[] = [];
      let n: ts.Node = node;
      while (ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n) {
        path.push(n.parent.name.text);
        n = n.parent;
      }
      if (path.length) paths.push(path);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return paths;
}

/** Pieces of text that are words a player reads (a regular expression or a name is code, not words) */
const isWords = (h: Hit) => !h.kept && h.kind !== "regex" && h.kind !== "name";

/**
 * Sentences put together from pieces of the code (a JSX line with values and tags in it),
 * by name in zh.ts: the pieces, in order, a value or tag between them being a blank.
 */
type Join = { key: string; file: string; pieces: string[] };

export type Report = {
  base: string;
  /** Pieces of text at base, and where each is now */
  pieces: number;
  unchanged: number;
  moved: number;
  /** Text at base found nowhere now, or changed */
  lost: { file: string; line: number; text: string }[];
  /** Words in zh.ts that were nowhere in the code at base */
  added: { key: string; text: string }[];
  /** zh.ts names the code reads that zh.ts does not have */
  dangling: { file: string; key: string }[];
  /** Base pieces found moved into another file's reads (allowed, listed) */
  elsewhere: { file: string; line: number; text: string; now: string }[];
};

function filesAt(base: string, root: string) {
  const list = execFileSync("git", ["ls-tree", "-r", "--name-only", base, "--", "src"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts"));
  return list.map((f) => ({ file: f, source: execFileSync("git", ["show", `${base}:${f}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }) }));
}

export async function verify(root: string, base: string): Promise<Report> {
  const before = filesAt(base, root).flatMap(({ file, source }) => scanSource(file, source)).filter(isWords);
  const nowFiles = sourceFiles(root).map((file) => ({ file, source: readFileSync(join(root, file), "utf8") }));
  const now = nowFiles.flatMap(({ file, source }) => scanSource(file, source)).filter(isWords);
  const { zh } = (await import(pathToFileURL(join(root, "src/i18n/zh.ts")).href)) as { zh: Value };
  const joinsPath = join(root, "scripts/i18n/joins.json");
  const joins: Join[] = existsSync(joinsPath) ? JSON.parse(readFileSync(joinsPath, "utf8")) : [];

  const report: Report = { base, pieces: before.length, unchanged: 0, moved: 0, lost: [], added: [], dangling: [], elsewhere: [] };

  // what each file still says itself, and what it reads from zh.ts, as counts of normalized text
  const bag = () => new Map<string, number>();
  const take = (m: Map<string, number>, k: string) => {
    const n = m.get(k) ?? 0;
    if (!n) return false;
    m.set(k, n - 1);
    return true;
  };
  const put = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
  const own = new Map<string, Map<string, number>>();
  const reads = new Map<string, Map<string, number>>();
  for (const h of now) put(own.get(h.file) ?? own.set(h.file, bag()).get(h.file)!, normalize(h.text));
  for (const { file, source } of nowFiles) {
    const r = reads.get(file) ?? reads.set(file, bag()).get(file)!;
    for (const path of readsOf(file, source)) {
      const v = at(zh, path);
      if (v === undefined) {
        report.dangling.push({ file, key: path.join(".") });
        continue;
      }
      // a value read many times in a file can stand for that many pieces of it
      for (const s of strings(v)) put(r, normalize(s), 1000);
    }
  }
  // a joined sentence stands for its pieces, in the file they came from
  for (const j of joins) for (const p of j.pieces) put(reads.get(j.file) ?? reads.set(j.file, bag()).get(j.file)!, normalize(p), 1000);

  for (const h of before) {
    const text = normalize(h.text);
    if (take(own.get(h.file) ?? bag(), text)) report.unchanged++;
    else if ((reads.get(h.file)?.get(text) ?? 0) > 0) report.moved++;
    else {
      const other = [...reads].find(([, m]) => (m.get(text) ?? 0) > 0)?.[0];
      if (other) {
        report.moved++;
        report.elsewhere.push({ file: h.file, line: h.line, text: h.text, now: other });
      } else report.lost.push({ file: h.file, line: h.line, text: h.text });
    }
  }

  // nothing new: every word in zh.ts was in the code at base, or is a sentence joined from pieces that were
  const said = new Set(before.map((h) => normalize(h.text)));
  const joined = new Map(joins.map((j) => [j.key, j]));
  const walk = (v: Value, path: string[]) => {
    if (typeof v === "string") {
      const key = path.join(".");
      const j = joined.get(key) ?? joined.get(path.slice(0, -1).join("."));
      if (!said.has(normalize(v)) && !(j && j.pieces.every((p) => said.has(normalize(p))) && joinedText(j) === normalize(v)))
        report.added.push({ key, text: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)]));
    else for (const [k, x] of Object.entries(v as Record<string, Value>)) walk(x, [...path, k]);
  };
  walk(zh, []);
  return report;
}

/** A joined sentence as its pieces make it: each piece, a blank between each two */
function joinedText(j: Join) {
  return normalize(j.pieces.join("{}"));
}

async function main(argv: string[]) {
  const baseAt = argv.indexOf("--base");
  const base = baseAt >= 0 ? argv[baseAt + 1] : "origin/main";
  const reportAt = argv.indexOf("--report");
  const report = await verify(process.cwd(), base);
  if (reportAt >= 0) writeFileSync(argv[reportAt + 1], JSON.stringify(report, null, 1));
  console.log(`Against ${base}: ${report.pieces} pieces of text; ${report.unchanged} still in the code as they were, ${report.moved} in zh.ts word for word.`);
  if (report.elsewhere.length) console.log(`${report.elsewhere.length} read from another file now (allowed):\n  ${report.elsewhere.map((e) => `${e.file}:${e.line} → ${e.now}  ${e.text}`).join("\n  ")}`);
  const bad = report.lost.length + report.added.length + report.dangling.length;
  for (const l of report.lost) console.log(`LOST    ${l.file}:${l.line}  ${l.text}`);
  for (const a of report.added) console.log(`NEW     zh.${a.key}  ${a.text}`);
  for (const d of report.dangling) console.log(`MISSING ${d.file} reads T.${d.key}, which zh.ts lacks`);
  console.log(bad ? `${bad} problems` : "Word for word the same.");
  process.exitCode = bad ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) await main(process.argv.slice(2));
