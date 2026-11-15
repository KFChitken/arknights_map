import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nudge, STREAMS_EACH } from "@/lib/server/live";
import type { UserRow } from "@/lib/server/schema";
import { GET } from "./route";

// The player signed in for each request: set by the test, as a session cookie would
const signedIn = vi.hoisted(() => ({ user: null as UserRow | null }));
vi.mock("@/lib/server/auth", async (original) => ({
  ...(await original<typeof import("@/lib/server/auth")>()),
  currentUser: vi.fn(async () => signedIn.user),
}));

const leaving: AbortController[] = [];
afterEach(() => {
  for (const page of leaving.splice(0)) page.abort();
  signedIn.user = null;
});

const decoder = new TextDecoder();

/** A page's event stream, read a piece at a time as EventSource reads it; null once the server has closed it */
async function connect(playerId: string | null) {
  signedIn.user = playerId ? ({ id: playerId } as UserRow) : null;
  const page = new AbortController();
  leaving.push(page);
  const res = await GET(new NextRequest("http://localhost/api/events", { signal: page.signal }));
  const reader = res.status === 200 ? res.body!.getReader() : null;
  return {
    status: res.status,
    read: async () => {
      const { value, done } = await reader!.read();
      return done ? null : decoder.decode(value);
    },
    leave: () => page.abort(),
  };
}

const INBOX = "event: inbox\ndata: {}\n\n";

describe("the event stream (GET /api/events)", () => {
  it("is only for a signed-in player", async () => {
    expect((await connect(null)).status).toBe(401);
  });

  it("keeps at most STREAMS_EACH pages of one player: one more and the oldest gives way, told to wait ten minutes", async () => {
    const pages = [];
    for (let i = 0; i < STREAMS_EACH; i++) {
      const page = await connect("p1");
      expect(page.status).toBe(200);
      expect(await page.read()).toBe("retry: 5000\n\n");
      pages.push(page);
    }
    const someoneElse = await connect("p2");
    await someoneElse.read();

    const newest = await connect("p1");
    expect(newest.status).toBe(200);
    expect(await newest.read()).toBe("retry: 5000\n\n");
    expect(await pages[0].read()).toBe("retry: 600000\n\n");
    expect(await pages[0].read()).toBeNull();

    // the rest still hear, the other player's page too
    nudge(["p1", "p2"]);
    for (const page of [...pages.slice(1), newest, someoneElse]) expect(await page.read()).toBe(INBOX);
  });

  it("counts only the pages still open", async () => {
    const pages = [];
    for (let i = 0; i < STREAMS_EACH; i++) {
      const page = await connect("p1");
      await page.read();
      pages.push(page);
    }
    pages[0].leave();
    const next = await connect("p1");
    await next.read();

    nudge(["p1"]);
    for (const page of [...pages.slice(1), next]) expect(await page.read()).toBe(INBOX);
  });
});
