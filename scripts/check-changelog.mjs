// Does each commit add exactly one row to the change log, on top? src/lib/changelog.ts keeps one row a line, newest
// first, and every commit adds its own row as the first of CHANGELOG, changing no other line. A rebase, a cherry-pick
// or `git am -3` can move that row into the middle or swallow it with no conflict to say so (.gitattributes merges the
// file with union), and the page then shows the change on the wrong day, or not at all.
// usage: node scripts/check-changelog.mjs [range]
//   range: the commits to check, as git takes them (A..B); one commit alone (B) is B~1..B. Default HEAD~1..HEAD.
// Exits 1 when a commit adds no row, more than one, one anywhere but on top, or changes or takes away another line,
// saying which commit and how to put it right. Merge commits are passed over: the commits they bring are checked.
import { execFileSync } from "node:child_process";

const FILE = "src/lib/changelog.ts";
/** The line that opens the rows: the first row is the line right after it */
const OPENER = "export const CHANGELOG: readonly ChangeRow[] = [";
/** One row, as the file writes each */
const ROW = /^ {2}\{ date: "\d{4}-\d{2}-\d{2}", kind: "[a-z]+", text: "[^"\\]*" \},$/;
const FIX = [
  `Put it right: in that commit, ${FILE} gets exactly one new line, its own row, as the first line inside`,
  'CHANGELOG ({ date: "<Beijing date>", kind: "chore", text: "后台调整" }, or a row players read), and no other line',
  "changes. A rebase, a cherry-pick or `git am -3` moves this row into the middle or swallows it (the file merges",
  "with union, .gitattributes): apply a patch with plain `git am`, then put your row back on top.",
].join("\n");

const run = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
/** The change log as a commit has it, or null where it has none */
function fileAt(rev) {
  try {
    return run(["show", `${rev}:${FILE}`]);
  } catch {
    return null;
  }
}

/** What is wrong with a commit's change to the change log; null when it adds one row on top and changes nothing else */
function problem(c) {
  const after = fileAt(c);
  if (after === null) return `it has no ${FILE}`;
  const before = fileAt(`${c}^`);
  // the commit that made the change log, with nothing before it to add to
  if (before === null) return null;
  const lines = after.split("\n");
  const open = lines.indexOf(OPENER);
  if (open < 0) return `its ${FILE} has no line \`${OPENER}\``;
  const top = lines[open + 1];
  // the commit's file with its first row taken out is the parent's to the letter: one line added, on top, and no other
  // (a row the same as the ones on top of it may be shown by git as added below them: the file comes out the same)
  const rest = [...lines.slice(0, open + 1), ...lines.slice(open + 2)].join("\n");
  if (rest === before) return ROW.test(top) ? null : `the line it adds on top is not one row: ${top}`;
  const [added = 0, removed = 0] = run(["diff", "--numstat", `${c}^`, c, "--", FILE]).trim().split(/\s+/).map(Number);
  if (!added && !removed) return "it adds no row";
  if (removed) return `it takes away or changes ${removed} line${removed > 1 ? "s" : ""} (and adds ${added})`;
  if (added > 1) return `it adds ${added} lines, not one`;
  const at = /^@@ -\d+(?:,\d+)? \+(\d+)/m.exec(run(["diff", "-U0", `${c}^`, c, "--", FILE]))?.[1];
  return `it adds a line at line ${at}, not on top (line ${open + 2})`;
}

const arg = process.argv[2] ?? "HEAD~1..HEAD";
const range = arg.includes("..") ? arg : `${arg}~1..${arg}`;
let commits;
let merges;
try {
  commits = run(["rev-list", "--reverse", "--no-merges", range]).split("\n").filter(Boolean);
  merges = run(["rev-list", "--merges", range]).split("\n").filter(Boolean).length;
} catch (e) {
  console.error(`Cannot list the commits of ${range}: ${String(e.stderr || e.message).trim()}`);
  process.exit(2);
}
const passed = merges ? ` (${merges} merge commit${merges > 1 ? "s" : ""} passed over)` : "";
const wrong = commits.map((c) => [c, problem(c)]).filter(([, p]) => p);
if (wrong.length) {
  const n = commits.length;
  const which = n === 1 ? `the commit in ${range} does not add` : `${wrong.length} of the ${n} commits in ${range} do not add`;
  console.error(`Change log: ${which} one row on top:`);
  for (const [c, p] of wrong) console.error(`  ${run(["log", "-1", "--format=%h %s", c]).trim()}\n    ${p}`);
  console.error(FIX);
  process.exit(1);
}
const n = commits.length;
const which = n === 1 ? "the commit" : `each of the ${n} commits`;
console.log(n ? `Change log: ${which} in ${range} adds one row, on top${passed}.` : `Change log: no commits in ${range}${passed}.`);
