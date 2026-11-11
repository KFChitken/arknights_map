import "server-only";
import https from "node:https";

/**
 * fetch for https URLs, made through another address (host:port) that passes the bytes on unread:
 * the second server (deploy/relay) for a service that refused the main server's own address. The
 * connection is still to the URL's host as far as TLS goes (its name is sent and its certificate
 * checked), so the relay sees nothing of what is asked. GET only, bodies read whole.
 */
export function fetchVia(via: string): typeof fetch {
  const [host, port = "443"] = via.split(":");
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return new Promise<Response>((resolve, reject) => {
      const headers: Record<string, string> = { host: url.host };
      new Headers(init?.headers).forEach((value, name) => (headers[name] = value));
      const req = https.request(
        { host, port: Number(port), servername: url.hostname, path: url.pathname + url.search, method: "GET", headers, agent: false },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error", reject);
          res.on("end", () => {
            const out = new Headers();
            for (const [name, value] of Object.entries(res.headers)) if (typeof value === "string") out.set(name, value);
            resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 502, headers: out }));
          });
        },
      );
      const signal = init?.signal;
      if (signal?.aborted) req.destroy(signal.reason);
      signal?.addEventListener("abort", () => req.destroy(signal.reason), { once: true });
      req.on("error", reject);
      req.end();
    });
  }) as typeof fetch;
}
