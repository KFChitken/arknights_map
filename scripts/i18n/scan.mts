/**
 * Finds every piece of text in the code that holds Chinese (or other CJK)
 * characters: string literals, template literals and JSX text. Comments are
 * never seen, as the TypeScript parser drops them; import paths are skipped.
 *
 *   node scripts/i18n/scan.mts                 totals and the files with the most text
 *   node scripts/i18n/scan.mts --all           every file
 *   node scripts/i18n/scan.mts --json out.json every hit, for the checks
 *   node scripts/i18n/scan.mts --dir src/lib   only under that folder
 *
 * The checks in scripts/i18n/verify.ts and src/i18n/i18n.test.ts use scanSource
 * and scanTree from here.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

export type HitKind = "string" | "template" | "jsx-text" | "jsx-attr" | "regex" | "name";

export type Hit = {
  /** Path from the repository root, with forward slashes */
  file: string;
  /** 1-based line and column of the start of the literal */
  line: number;
  col: number;
  kind: HitKind;
  /**
   * The text as the player would read it. Template literals have their `${}`
   * written as {0}, {1}… in order; JSX text is trimmed the way React trims it.
   */
  text: string;
  /** The `${}` expressions of a template literal, as written */
  args: string[];
  /** Offsets of the whole literal in the file */
  start: number;
  end: number;
  /** Why it stays Chinese, when it does (see KEPT) */
  kept: string | null;
  /**
   * Whether code decides something by these words: compares with them, looks for them
   * in other text, matches them (a regular expression), or names a property with them.
   * Words like these must keep working when the text a player reads changes language.
   */
  logic: boolean;
};

/** Han, kana, Hangul, CJK punctuation and full-width forms */
export const CJK = /[⺀-⿿　-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿가-힯豈-﫿︰-﹏＀-￯]/;

/**
 * Files whose text stays Chinese: the admin page, the site's own checks and
 * alert emails, and the tests. Paths from the repository root; a folder ends in /.
 */
export const KEPT: [prefix: string, why: string][] = [
  ["src/app/admin/", "admin"],
  ["src/app/api/admin/", "admin"],
  ["src/components/AdminApp.tsx", "admin"],
  ["src/lib/server/admin.ts", "admin"],
  ["src/lib/server/watch.ts", "watch"],
  ["src/lib/server/watchReport.ts", "watch"],
  ["src/lib/server/watchSignals.ts", "watch"],
  ["src/lib/siteStatus.ts", "watch"],
];

export function keptFile(file: string): string | null {
  if (/\.test\.tsx?$/.test(file)) return "test";
  for (const [prefix, why] of KEPT) if (prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix) return why;
  return null;
}

const hasCjk = (s: string) => CJK.test(s);

/**
 * How React turns JSX text into what is shown: lines are trimmed, lines that are
 * only whitespace are dropped, and the rest are joined with one space.
 */
export function jsxTextValue(raw: string) {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return raw;
  const kept: string[] = [];
  lines.forEach((line, i) => {
    let s = line.replace(/\t/g, " ");
    if (i > 0) s = s.replace(/^[ ]+/, "");
    if (i < lines.length - 1) s = s.replace(/[ ]+$/, "");
    if (s) kept.push(s);
  });
  return kept.join(" ");
}

const SEARCHES = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "replace", "replaceAll", "split", "match", "matchAll", "search"]);
const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** Whether the literal is something code decides by (see Hit.logic) */
function decidesBy(node: ts.Node): boolean {
  let n = node;
  // ("a" as const), ("a")
  while (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent)) n = n.parent;
  const p = n.parent;
  if (ts.isBinaryExpression(p) && COMPARISONS.has(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p) && p.expression === n) return true;
  if (ts.isCallExpression(p) && p.arguments[0] === n && ts.isPropertyAccessExpression(p.expression) && SEARCHES.has(p.expression.name.text)) return true;
  // "…".includes(x)
  if (ts.isPropertyAccessExpression(p) && p.expression === n && SEARCHES.has(p.name.text)) return true;
  // { "能天使": … } and x["能天使"]
  if ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === n) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  return false;
}

/** console.log("…") and the like are for us, not the player */
function inConsoleCall(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const callee = p.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "console") return true;
    }
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

function isModuleSpecifier(node: ts.Node) {
  const p = node.parent;
  return (
    (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node
  ) || (ts.isExternalModuleReference(p)) || (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword) || ts.isImportTypeNode(p.parent ?? p);
}

export function scanSource(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const fileKept = keptFile(file);
  const hits: Hit[] = [];
  const add = (node: ts.Node, kind: HitKind, text: string, args: string[] = []) => {
    const start = node.getStart(sf);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const kept = fileKept ?? (inConsoleCall(node) ? "console" : null);
    const logic = kind === "regex" || kind === "name" || decidesBy(node);
    hits.push({ file, line: line + 1, col: character + 1, kind, text, args, start, end: node.getEnd(), kept, logic });
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      // a string type ("猫" in type Title = "猫" | …) names a value, it is not text itself
      if (ts.isLiteralTypeNode(node.parent)) return;
      if (hasCjk(node.text) && !isModuleSpecifier(node)) {
        const kind = ts.isJsxAttribute(node.parent) ? "jsx-attr" : ts.isStringLiteral(node) ? "string" : "template";
        add(node, kind, node.text);
      }
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      if (parts.some(hasCjk)) {
        let text = node.head.text;
        node.templateSpans.forEach((s, i) => (text += `{${i}}` + s.literal.text));
        add(node, "template", text, node.templateSpans.map((s) => s.expression.getText(sf)));
      }
      // the expressions inside may hold text of their own
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    if (ts.isJsxText(node)) {
      const value = jsxTextValue(node.text);
      if (hasCjk(value)) add(node, "jsx-text", value);
      return;
    }
    if (ts.isRegularExpressionLiteral(node)) {
      if (hasCjk(node.text)) add(node, "regex", node.text);
      return;
    }
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (hasCjk(node.text)) add(node, "name", node.text);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

export function sourceFiles(root: string, dir = "src"): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const p = join(abs, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(relative(root, p).split(sep).join("/"));
    }
  };
  walk(join(root, dir));
  return out.sort();
}

export function scanTree(root: string, dir = "src"): Hit[] {
  return sourceFiles(root, dir).flatMap((f) => scanSource(f, readFileSync(join(root, f), "utf8")));
}

/** Characters a reader would count: the CJK ones */
export const cjkChars = (s: string) => [...s].filter((c) => CJK.test(c)).length;

function main(argv: string[]) {
  const root = process.cwd();
  const dirAt = argv.indexOf("--dir");
  const dir = dirAt >= 0 ? argv[dirAt + 1] : "src";
  const hits = scanTree(root, dir);
  const jsonAt = argv.indexOf("--json");
  if (jsonAt >= 0) {
    const out = argv[jsonAt + 1];
    writeFileSync(out, JSON.stringify(hits, null, 1));
    console.log(`${hits.length} hits written to ${out}`);
    return;
  }
  if (argv.includes("--logic")) {
    for (const h of hits.filter((x) => x.logic && !x.kept)) console.log(`${h.file}:${h.line}  ${h.kind}  ${h.text}`);
    return;
  }
  const moved = hits.filter((h) => !h.kept && h.kind !== "regex" && h.kind !== "name");
  const kept = hits.filter((h) => h.kept);
  const byFile = new Map<string, { n: number; chars: number }>();
  for (const h of moved) {
    const f = byFile.get(h.file) ?? { n: 0, chars: 0 };
    f.n++;
    f.chars += cjkChars(h.text);
    byFile.set(h.file, f);
  }
  const sum = (hs: Hit[]) => hs.reduce((a, h) => a + cjkChars(h.text), 0);
  console.log(`To move: ${moved.length} pieces, ${sum(moved)} characters, in ${byFile.size} files`);
  const why = new Map<string, Hit[]>();
  for (const h of kept) why.set(h.kept!, [...(why.get(h.kept!) ?? []), h]);
  for (const [w, hs] of why) console.log(`Stays Chinese (${w}): ${hs.length} pieces, ${sum(hs)} characters`);
  const rows = [...byFile].sort((a, b) => b[1].chars - a[1].chars);
  const shown = argv.includes("--all") ? rows : rows.slice(0, 30);
  for (const [f, { n, chars }] of shown) console.log(`${String(chars).padStart(6)}  ${String(n).padStart(4)}  ${f}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
