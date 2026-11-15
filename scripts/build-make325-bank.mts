// Write src/data/make325-bank.json: every 凑 325 puzzle a round can deal (src/lib/study/make325.ts), so that a phone
// never searches for one. A puzzle is four different numbers of MAKE_POOL, smallest first, that make 325 at least two
// ways while no two or three of them make it alone (fair). Run from the repository root after the pool or fair change:
//
//   npx tsx scripts/build-make325-bank.mts
//
// src/lib/study/make325.test.ts checks the file against a count made afresh.
import { writeFileSync } from "node:fs";
import { fair, MAKE_POOL } from "../src/lib/study/make325";

const OUT = "src/data/make325-bank.json";

const pool = [...MAKE_POOL].sort((a, b) => a - b);
const bank: number[][] = [];
for (let a = 0; a < pool.length; a++)
  for (let b = a + 1; b < pool.length; b++)
    for (let c = b + 1; c < pool.length; c++)
      for (let d = c + 1; d < pool.length; d++) {
        const nums = [pool[a], pool[b], pool[c], pool[d]];
        if (fair(nums)) bank.push(nums);
      }

// one puzzle a line
const note = "Every 凑 325 puzzle a round can deal (scripts/build-make325-bank.mts): four numbers, smallest first";
writeFileSync(OUT, `{\n  "note": ${JSON.stringify(note)},\n  "puzzles": [\n${bank.map((p) => `    ${JSON.stringify(p)}`).join(",\n")}\n  ]\n}\n`);
console.log(`${OUT}: ${bank.length} puzzles of the ${pool.length} numbers`);
