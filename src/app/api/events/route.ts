import { T } from "@/i18n";
import { currentUser } from "@/lib/server/auth";
import { inLang } from "@/lib/server/http";
import { listen } from "@/lib/server/live";

export const dynamic = "force-dynamic";

// A comment line now and then keeps proxies and phones from dropping a quiet connection
const PING_MS = 25_000;
// A stream that gave way to a newer page of the same player (STREAMS_EACH in src/lib/server/live.ts): a page
// still on it waits ten minutes before asking again, so pages past the cap do not keep pushing one another out
const GAVE_WAY_RETRY_MS = 600_000;

/**
 * Server-sent events for the signed-in player: an "inbox" event whenever something new arrives (and "declare",
 * "help"), with nothing in it; and "listen" with what their room of 一起听 did (src/lib/listen.ts ListenTell).
 */
export const GET = inLang(async (req: Request) => {
  const user = await currentUser();
  if (!user) return new Response(T.server.common.signIn, { status: 401 });

  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      const off = listen(
        user.id,
        (event, data) => send(`event: ${event}\ndata: ${data ?? "{}"}\n\n`),
        () => {
          send(`retry: ${GAVE_WAY_RETRY_MS}\n\n`);
          stop();
          try {
            controller.close();
          } catch {}
        },
      );
      const ping = setInterval(() => send(": ping\n\n"), PING_MS);
      stop = () => {
        clearInterval(ping);
        off();
      };
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
      send("retry: 5000\n\n");
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform keeps compression from holding events back
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
});
