import { currentUser } from "@/lib/server/auth";
import { listen } from "@/lib/server/live";

export const dynamic = "force-dynamic";

// A comment line now and then keeps proxies and phones from dropping a quiet connection
const PING_MS = 25_000;

/** Server-sent events for the signed-in player: an "inbox" event whenever something new arrives. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("请先登录。", { status: 401 });

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
      const off = listen(user.id, () => send("event: inbox\ndata: {}\n\n"));
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
}
