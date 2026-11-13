import { afterEach, describe, expect, it, vi } from "vitest";
import { listenToAmapConsole } from "./report";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("高德's console messages", () => {
  it("take a key whose allowance is used up for a refusal, whichever code 高德 says it with", () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("window", { setTimeout: (f: () => void) => f() });
    const refused: string[] = [];
    const before = console.error;
    console.error = () => {};
    try {
      const undo = listenToAmapConsole((code) => refused.push(code));
      // from the map itself, without 「KEY异常」
      console.error("FlyDataAuthTask error: QUOTA_PLAN_RUN_OUT");
      undo();
    } finally {
      console.error = before;
    }
    expect(refused).toEqual(["QUOTA_PLAN_RUN_OUT"]);
    expect(sent).toEqual([{ map: "amap", what: "key", detail: "QUOTA_PLAN_RUN_OUT" }]);
  });
});
