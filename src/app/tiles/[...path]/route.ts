import { open, stat } from "node:fs/promises";
import path from "node:path";
import { isProd, TILES_DIR } from "@/lib/server/env";

/**
 * GET /tiles/...: our own overseas map's files (src/lib/overseas.ts) in development.
 * On the live site Caddy serves them straight from the server's folder and this
 * route is never reached. The map file is read in the ranges the map asks for.
 */

const TYPES: Record<string, string> = {
  ".pmtiles": "application/octet-stream",
  ".pbf": "application/x-protobuf",
  ".json": "application/json",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};
/** Whole files only up to this size; the map file is asked for in ranges */
const WHOLE_MAX = 5_000_000;

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (isProd) return new Response("Not found", { status: 404 });
  const root = path.resolve(TILES_DIR);
  const file = path.resolve(root, ...(await params).path);
  const type = TYPES[path.extname(file)];
  if (!file.startsWith(root + path.sep) || !type) return new Response("Not found", { status: 404 });
  const size = await stat(file).then((s) => (s.isFile() ? s.size : -1), () => -1);
  if (size < 0) return new Response("Not found", { status: 404 });

  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range ? Math.min(size - 1, range[2] ? Number(range[2]) : size - 1) : size - 1;
  if (start > end || (!range && size > WHOLE_MAX)) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const bytes = new Uint8Array(end - start + 1);
  const handle = await open(file, "r");
  try {
    await handle.read(bytes, 0, bytes.length, start);
  } finally {
    await handle.close();
  }
  return new Response(bytes, {
    status: range ? 206 : 200,
    headers: {
      "content-type": type,
      "accept-ranges": "bytes",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
      "cache-control": "no-cache",
    },
  });
}
