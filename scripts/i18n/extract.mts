/**
 * Moves text from the code into src/i18n/zh.ts, as the plans in scripts/i18n/plans say:
 * each plan names, file by file, the words to move and the name each gets. Then the
 * code reads them through T. Run it on a fresh copy of main with the plans so far;
 * when main has changed, run it again rather than merging by hand.
 *
 *   node scripts/i18n/extract.mts            move the words, rewrite src/i18n/zh.ts
 *   node scripts/i18n/extract.mts --check    only report: what would move, and what the plans miss
 *
 * A plan (scripts/i18n/plans/<step>.json), file by file:
 *
 *   "src/lib/server/passwords.ts": {
 *     "group": "server.passwords",        where its words go in zh.ts (T.server.passwords.…)
 *     "only": "errors",                   what this step means to move from it, to report what the plan misses:
 *                                         "errors" (new …Error(…), { error: … }), "named" (just its words)
 *                                         or, by default, everything
 *     "words": { "wrong": "邮箱或密码不对。" },   name → the Chinese, a template's ${…} as {name}, in order
 *     "keep": ["…"],                      text in it that stays where it is (data, or what code decides by)
 *     "edits": [{ "from": "…", "to": "…" }]  changes by hand first, each found exactly once
 *   }
 *
 * and words several of its files say, by their whole name, for the files under some folders:
 *
 *   "common": [{ "files": ["src/lib/server/"], "words": { "server.common.signIn": "请先登录。" } }]
 *
 * Every piece of text in the file that reads exactly like one of its words is moved:
 * a string or template becomes T.group.name (or fmt(T.group.name, { name: … }) with
 * blanks), JSX text {T.group.name}, a JSX attribute attr={T.group.name}. T is never
 * read at the top of a module (one server answers in two languages): there, a property
 * of an object becomes a getter, and a constant only its own file uses is put where it
 * is used. Anything else at the top of a module needs an edit in the plan.
 *
 * The words moved are added to src/i18n/zh.ts, each at the end of its group, and
 * nothing else in it changes: words written there by hand since stay as they are.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { scanSource, type Hit } from "./scan.mts";
import { normalize } from "./verify.mts";

type Edit = { from: string; to: string };
type FilePlan = { group: string; only?: "errors" | "named"; words: Record<string, string>; keep?: string[]; edits?: Edit[] };
/** Words said in more than one file: by their whole name, for the plan's files under these folders */
type Common = { files: string[]; words: Record<string, string> };
type Plan = { about?: string; common?: Common[]; files: Record<string, FilePlan> };

const ROOT = process.cwd();
const PLANS = join(ROOT, "scripts/i18n/plans");
const NAME = /^[A-Za-z_$][\w$]*$/;

export function loadPlans(dir = PLANS): { name: string; plan: Plan }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ name: f, plan: JSON.parse(readFileSync(join(dir, f), "utf8")) as Plan }));
}

/** The blanks of a word, in order: 「{who}一直醒着，碰碰{them}吧」 → who, them */
export const blanks = (word: string) => [...word.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);

const isFunctionBoundary = (n: ts.Node) =>
  ts.isFunctionLike(n) || (ts.isPropertyDeclaration(n) && !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword));

/** Whether code at node runs when the module is loaded, rather than when something is called */
function atModuleLevel(node: ts.Node) {
  for (let n = node.parent; n && !ts.isSourceFile(n); n = n.parent) if (isFunctionBoundary(n)) return false;
  return true;
}

/** Whether the text is what an error says: new …Error(…), new …Needed(…), new Response(…), { error: … } */
function inError(node: ts.Node) {
  for (let n = node.parent; n && !ts.isSourceFile(n) && !isFunctionBoundary(n); n = n.parent) {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /Error$|Needed$|^TooBusy$|^Response$/.test(n.expression.text)) return true;
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "error") return true;
  }
  return false;
}

type Change = { start: number; end: number; text: string };

type Moved = { file: string; line: number; path: string; text: string };
export type Report = {
  moved: Moved[];
  /** pieces the step means to move (its "only") that no word of the plan reads like */
  unplanned: { file: string; line: number; text: string }[];
  /** words of a plan the code neither says nor reads */
  stale: { file: string; path: string; text: string }[];
  /** what could not be done, and why */
  problems: string[];
};

function findNode(sf: ts.SourceFile, h: Hit): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (n: ts.Node) => {
    if (found || n.pos > h.start || n.end < h.end) return;
    const ok =
      (h.kind === "jsx-text" && ts.isJsxText(n)) ||
      ((h.kind === "string" || h.kind === "jsx-attr") && ts.isStringLiteral(n)) ||
      (h.kind === "template" && (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.getStart(sf) === h.start) ||
      (h.kind === "string" && ts.isNoSubstitutionTemplateLiteral(n));
    if (ok && n.getStart(sf) === h.start && n.end === h.end) found = n;
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The expression that reads a word: T.a.b, or fmt(T.a.b, { … }) with its blanks filled by the template's expressions */
function reading(path: string, word: string, args: string[], where: string): { expr: string; fmt: boolean } {
  const names = blanks(word);
  if (names.length !== args.length) throw new Error(`${where}: 「${word}」 has ${names.length} blanks, the code ${args.length}`);
  if (!names.length) return { expr: `T.${path}`, fmt: false };
  const given = new Map<string, string>();
  for (const [i, n] of names.entries()) {
    if (!NAME.test(n)) throw new Error(`${where}: blank {${n}} in 「${word}」 is not a name`);
    const prev = given.get(n);
    if (prev !== undefined && prev !== args[i]) throw new Error(`${where}: blank {${n}} stands for both ${prev} and ${args[i]}`);
    given.set(n, args[i]);
  }
  const fields = [...given].map(([n, a]) => (a === n ? n : `${n}: ${a}`)).join(", ");
  return { expr: `fmt(T.${path}, { ${fields} })`, fmt: true };
}

/** Puts import { T, fmt } from "@/i18n" into a file, beside its other imports */
function withImports(source: string, file: string, names: string[]): string {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const from = (s: ts.ImportDeclaration) => (ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : "");
  const ours = imports.find((s) => from(s) === "@/i18n" && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings));
  const sorted = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));
  if (ours) {
    const clause = ours.importClause!;
    const bindings = clause.namedBindings as ts.NamedImports;
    // import type { Lang } becomes import { T, type Lang }
    const have = bindings.elements.map((e) => (clause.isTypeOnly && !e.isTypeOnly ? `type ${e.getText(sf)}` : e.getText(sf)));
    return source.slice(0, clause.getStart(sf)) + `{ ${sorted([...have, ...names]).join(", ")} }` + source.slice(clause.end);
  }
  const line = `import { ${sorted(names).join(", ")} } from "@/i18n";\n`;
  // as the code goes: packages, then "@/…" in order, then the file's own folder ("./…", "../…")
  const alias = imports.filter((s) => from(s).startsWith("@/"));
  const before = alias.filter((s) => from(s) < "@/i18n");
  const next = alias.find((s) => from(s) > "@/i18n") ?? imports.find((s) => from(s).startsWith("."));
  const at = before.length
    ? before[before.length - 1].end + 1
    : next
      ? next.getStart(sf)
      : imports.length
        ? imports[imports.length - 1].end + 1
        : firstStatement(sf);
  return source.slice(0, at) + line + source.slice(at);
}

function firstStatement(sf: ts.SourceFile) {
  // after "use client" and the like
  const s = sf.statements.find((st) => !(ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)));
  return s ? s.getStart(sf) : sf.end;
}

/**
 * One file through one plan: its edits, then every piece that reads like one of its words.
 * Returns the new source, what moved, and which of its words were found.
 */
function moveFile(file: string, source: string, fp: FilePlan, common: Record<string, string>, report: Report): { source: string; found: Set<string> } {
  for (const e of fp.edits ?? []) {
    const n = source.split(e.from).length - 1;
    if (n !== 1) {
      report.problems.push(`${file}: an edit's text is there ${n} times, not once: ${e.from.slice(0, 80)}`);
      continue;
    }
    source = source.replace(e.from, () => e.to);
  }
  for (const k of Object.keys(fp.words)) if (!k.split(".").every((s) => NAME.test(s))) report.problems.push(`${file}: "${k}" is not a name T can read`);
  for (const s of fp.group.split(".")) if (!NAME.test(s)) report.problems.push(`${file}: group "${fp.group}" is not a name T can read`);

  // its words by what they say: its own first, then the ones its folder shares
  const byText = new Map<string, { path: string; word: string }>();
  for (const [k, w] of Object.entries(fp.words)) {
    const n = normalize(w);
    if (byText.has(n)) report.problems.push(`${file}: 「${w}」 is named twice (${byText.get(n)!.path}, ${fp.group}.${k})`);
    byText.set(n, { path: `${fp.group}.${k}`, word: w });
  }
  for (const [path, w] of Object.entries(common)) if (!byText.has(normalize(w))) byText.set(normalize(w), { path, word: w });
  const keep = new Set((fp.keep ?? []).map(normalize));
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits = scanSource(file, source).filter((h) => !h.kept && !h.logic && h.kind !== "regex" && h.kind !== "name");
  const changes: Change[] = [];
  const found = new Set<string>();
  let usesFmt = false;
  const inlined = new Map<string, { decl: ts.VariableStatement; expr: string }>();

  for (const h of hits) {
    const text = h.text;
    const entry = byText.get(normalize(text));
    const node = findNode(sf, h);
    if (!entry) {
      const meant = fp.only === undefined || (fp.only === "errors" && node !== undefined && inError(node));
      if (meant && !keep.has(normalize(text))) report.unplanned.push({ file, line: h.line, text: h.text });
      continue;
    }
    if (!node) {
      report.problems.push(`${file}:${h.line}: could not find 「${h.text}」 in the code`);
      continue;
    }
    const { path, word } = entry;
    let read: { expr: string; fmt: boolean };
    try {
      read = reading(path, word, h.args, `${file}:${h.line}`);
    } catch (e) {
      report.problems.push((e as Error).message);
      continue;
    }
    found.add(path);
    usesFmt ||= read.fmt;
    report.moved.push({ file, line: h.line, path, text: h.text });

    if (h.kind === "jsx-text") {
      // keep the line breaks around it, which React drops anyway; spaces within a line it shows
      const raw = (node as ts.JsxText).text;
      const lead = /^\s*\n\s*/.exec(raw)?.[0] ?? "";
      const trail = /\s*\n\s*$/.exec(raw.slice(lead.length))?.[0] ?? "";
      changes.push({ start: node.pos, end: node.end, text: `${lead}{${read.expr}}${trail}` });
      continue;
    }
    if (h.kind === "jsx-attr") {
      changes.push({ start: h.start, end: h.end, text: `{${read.expr}}` });
      continue;
    }
    if (!atModuleLevel(node)) {
      changes.push({ start: h.start, end: h.end, text: read.expr });
      continue;
    }
    // at the top of the module: a property becomes a getter …
    let n: ts.Node = node;
    while (ts.isParenthesizedExpression(n.parent) || ts.isAsExpression(n.parent) || ts.isSatisfiesExpression(n.parent)) n = n.parent;
    const p = n.parent;
    if (ts.isPropertyAssignment(p) && p.initializer === n) {
      changes.push({ start: p.getStart(sf), end: p.end, text: `get ${p.name.getText(sf)}() {\n${indentOf(source, p.getStart(sf))}  return ${read.expr};\n${indentOf(source, p.getStart(sf))}}` });
      continue;
    }
    // … and a constant only this file uses goes where it is used
    if (ts.isVariableDeclaration(p) && p.initializer === n && ts.isIdentifier(p.name) && ts.isVariableDeclarationList(p.parent) && ts.isVariableStatement(p.parent.parent)) {
      const stmt = p.parent.parent;
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported && p.parent.declarations.length === 1) {
        inlined.set(p.name.text, { decl: stmt, expr: read.expr });
        continue;
      }
    }
    found.delete(path);
    report.moved.pop();
    report.problems.push(`${file}:${h.line}: 「${h.text}」 is read when the module loads; plan an edit for it`);
  }

  // the constants put where they are used: every other mention of the name in the file
  for (const [name, { decl, expr }] of inlined) {
    const uses: ts.Identifier[] = [];
    let shadowed = false;
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === name && n !== (decl.declarationList.declarations[0].name as ts.Node)) {
        const q = n.parent;
        const isName =
          (ts.isPropertyAccessExpression(q) && q.name === n) ||
          (ts.isPropertyAssignment(q) && q.name === n) ||
          ts.isPropertySignature(q) ||
          ts.isMethodDeclaration(q) ||
          (ts.isQualifiedName(q) && q.right === n);
        if ((ts.isVariableDeclaration(q) || ts.isParameter(q) || ts.isFunctionDeclaration(q)) && q.name === n) shadowed = true;
        else if (ts.isShorthandPropertyAssignment(q)) uses.push(n);
        else if (!isName) uses.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (shadowed) {
      report.problems.push(`${file}: ${name} is declared again somewhere in the file; plan an edit for it`);
      continue;
    }
    if (uses.some((u) => atModuleLevel(u))) {
      report.problems.push(`${file}: ${name} is used when the module loads; plan an edit for it`);
      continue;
    }
    for (const u of uses)
      changes.push({ start: u.getStart(sf), end: u.end, text: ts.isShorthandPropertyAssignment(u.parent) ? `${name}: ${expr}` : expr });
    // the statement and the comment above it, keeping the line break that ends the line before
    const start = decl.getFullStart() + (source[decl.getFullStart()] === "\n" ? 1 : 0);
    changes.push({ start, end: decl.end + (source[decl.end] === "\n" ? 1 : 0), text: "" });
  }

  changes.sort((a, b) => b.start - a.start);
  for (let i = 1; i < changes.length; i++)
    if (changes[i].end > changes[i - 1].start) report.problems.push(`${file}: two changes overlap at ${changes[i].start}`);
  let out = source;
  for (const c of changes) out = out.slice(0, c.start) + c.text + out.slice(c.end);
  if (changes.length && found.size) out = withImports(out, file, usesFmt ? ["T", "fmt"] : ["T"]);
  return { source: out, found };
}

/** The whitespace at the start of the line that offset is on */
function indentOf(source: string, offset: number) {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart))![0];
}

const ZH = "src/i18n/zh.ts";

/** The object literal of export const zh = { … } */
function zhObject(sf: ts.SourceFile): ts.ObjectLiteralExpression {
  for (const st of sf.statements)
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations) {
        let init = d.initializer;
        while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
        if (ts.isIdentifier(d.name) && d.name.text === "zh" && init && ts.isObjectLiteralExpression(init)) return init;
      }
  throw new Error(`${ZH} has no export const zh = { … }`);
}

const keyOf = (p: ts.ObjectLiteralElementLike, sf: ts.SourceFile) =>
  ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : p.name?.getText(sf);
const writeKey = (k: string) => (NAME.test(k) ? k : JSON.stringify(k));

/**
 * zh.ts with a word added at a dotted path, at the end of its group (groups made as needed),
 * or as it was when the word is there already; what is wrong, if anything
 */
export function withWord(source: string, path: string, word: string): { source: string; problem?: string } {
  const sf = ts.createSourceFile(ZH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let obj = zhObject(sf);
  const parts = path.split(".");
  for (const [i, k] of parts.entries()) {
    const prop = obj.properties.find((p) => keyOf(p, sf) === k);
    const last = i === parts.length - 1;
    if (!prop) {
      // after a comma that ends what the group holds
      const lastProp = obj.properties[obj.properties.length - 1];
      if (lastProp && !obj.properties.hasTrailingComma) return withWord(source.slice(0, lastProp.end) + "," + source.slice(lastProp.end), path, word);
      // the rest of the path, as groups around the word, before the closing brace of this one
      const closing = obj.end - 1;
      const lineStart = source.lastIndexOf("\n", closing - 1) + 1;
      const pad = /^[ \t]*/.exec(source.slice(lineStart))![0] + "  ";
      const rest = parts.slice(i);
      const lines = rest.map((r, j) => `${pad}${"  ".repeat(j)}${writeKey(r)}: ${j === rest.length - 1 ? `${JSON.stringify(word)},` : "{"}`);
      for (let j = rest.length - 2; j >= 0; j--) lines.push(`${pad}${"  ".repeat(j)}},`);
      // on its own line: after what the line before the brace holds, or replacing a brace on the same line
      const inline = source.slice(lineStart, closing).trim() !== "";
      const text = inline ? `\n${lines.join("\n")}\n${pad.slice(2)}` : `${lines.join("\n")}\n`;
      const at = inline ? closing : lineStart;
      return { source: source.slice(0, at) + text + source.slice(at) };
    }
    if (!ts.isPropertyAssignment(prop)) return { source, problem: `${path}: ${parts.slice(0, i + 1).join(".")} in ${ZH} is not a plain property` };
    const init = prop.initializer;
    if (last) {
      if (!ts.isStringLiteral(init) && !ts.isNoSubstitutionTemplateLiteral(init)) return { source, problem: `${path} in ${ZH} is a group, not a word` };
      return init.text === word ? { source } : { source, problem: `${path} in ${ZH} says 「${init.text}」, the plan 「${word}」` };
    }
    if (!ts.isObjectLiteralExpression(init)) return { source, problem: `${path}: ${parts.slice(0, i + 1).join(".")} in ${ZH} is a word, not a group` };
    obj = init;
  }
  return { source };
}

export function extract({ write }: { write: boolean }): Report {
  const report: Report = { moved: [], unplanned: [], stale: [], problems: [] };
  const plans = loadPlans();
  const sources = new Map<string, string>();
  // every word's text by its path, across plans and files, and the order to add them in
  const said = new Map<string, { word: string; where: string }>();
  const add = (path: string, word: string, where: string) => {
    const was = said.get(path);
    if (was && was.word !== word) report.problems.push(`${where}: ${path} is 「${was.word}」 in ${was.where} and 「${word}」 here`);
    else if (!was) said.set(path, { word, where });
  };
  for (const { name, plan } of plans) {
    const commonUsed = new Set<string>();
    for (const [file, fp] of Object.entries(plan.files)) {
      const common: Record<string, string> = {};
      for (const c of plan.common ?? [])
        if (c.files.some((f) => (f.endsWith("/") ? file.startsWith(f) : file === f))) Object.assign(common, c.words);
      const abs = join(ROOT, file);
      if (!existsSync(abs)) {
        report.problems.push(`${name}: ${file} is not there`);
        continue;
      }
      const before = sources.get(file) ?? readFileSync(abs, "utf8");
      const { source, found } = moveFile(file, before, fp, common, report);
      sources.set(file, source);
      const reads = (path: string) => found.has(path) || new RegExp(`\\bT\\.${path.replace(/\./g, "\\.")}\\b`).test(source);
      for (const [k, w] of Object.entries(fp.words)) {
        // a word moved before (by hand, or by an earlier run) is read already
        if (reads(`${fp.group}.${k}`)) add(`${fp.group}.${k}`, w, `${name} ${file}`);
        else report.stale.push({ file, path: `${fp.group}.${k}`, text: w });
      }
      for (const path of Object.keys(common)) if (reads(path)) commonUsed.add(path);
    }
    for (const c of plan.common ?? [])
      for (const [path, w] of Object.entries(c.words)) {
        if (!path.split(".").every((s) => NAME.test(s))) report.problems.push(`${name}: "${path}" is not a name T can read`);
        if (commonUsed.has(path)) add(path, w, `${name} common`);
        else report.stale.push({ file: `${name} common`, path, text: w });
      }
  }
  // the words into zh.ts, each new one at the end of its group
  let zh = readFileSync(join(ROOT, ZH), "utf8");
  for (const [path, { word, where }] of said) {
    const r = withWord(zh, path, word);
    if (r.problem) report.problems.push(`${where}: ${r.problem}`);
    zh = r.source;
  }
  if (write && !report.problems.length) {
    for (const [file, source] of sources) if (source !== readFileSync(join(ROOT, file), "utf8")) writeFileSync(join(ROOT, file), source);
    if (zh !== readFileSync(join(ROOT, ZH), "utf8")) writeFileSync(join(ROOT, ZH), zh);
  }
  return report;
}

function main(argv: string[]) {
  const check = argv.includes("--check");
  const report = extract({ write: !check });
  const files = new Set(report.moved.map((m) => m.file));
  console.log(`${check ? "Would move" : "Moved"} ${report.moved.length} pieces of text in ${files.size} files.`);
  for (const u of report.unplanned) console.log(`UNPLANNED ${u.file}:${u.line}  ${u.text}`);
  for (const s of report.stale) console.log(`STALE     ${s.file}  ${s.path}  ${s.text}`);
  for (const p of report.problems) console.log(`PROBLEM   ${p}`);
  if (report.problems.length && !check) console.log("Nothing was written.");
  process.exitCode = report.problems.length || report.unplanned.length || report.stale.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
