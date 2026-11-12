import { describe, expect, it, vi } from "vitest";
import { sourceFiles } from "../../scripts/i18n/scan.mts";

const ROOT = new URL("../..", import.meta.url).pathname;

/** Where in the code a stack says a read came from: its places outside src/i18n, the read first, then what called it */
function readFrom(stack: string): string {
  const at: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const m = /(\/src\/[^:)]+):(\d+)/.exec(line);
    if (m && !m[1].startsWith("/src/i18n/")) at.push(`${m[1].slice(1)}:${m[2]}`);
  }
  return at.join(" <- ") || stack;
}

describe("the code", () => {
  it("reads no words while its modules load, which a server shares between languages", async () => {
    // what i18n.test.ts cannot see in the code itself: a module that keeps a word of another one as it loads,
    // as `export const NAME = GUIDE.name` would once the name is read from T. Every module of src/lib,
    // src/components and src/app, loaded afresh, with T telling where it is read.
    const files = sourceFiles(ROOT).filter(
      (f) =>
        /^src\/(lib|components|app)\//.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        // a worker's script runs in a worker only
        !f.endsWith("Worker.ts"),
    );
    const real = globalThis.__ZP_I18N_SERVER!;
    let words = real;
    const reads: string[] = [];
    Object.defineProperty(globalThis, "__ZP_I18N_SERVER", {
      configurable: true,
      get: () => () => {
        reads.push(readFrom(new Error().stack ?? ""));
        return words();
      },
      // src/i18n/server.ts sets its own as it loads again
      set: (v: () => ReturnType<typeof real>) => {
        words = v;
      },
    });
    vi.resetModules();
    try {
      for (const f of files) await import(`${ROOT}${f}`);
    } finally {
      Object.defineProperty(globalThis, "__ZP_I18N_SERVER", { configurable: true, writable: true, value: real });
    }
    expect([...new Set(reads)]).toEqual([]);
  });
});
