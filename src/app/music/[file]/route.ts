import { open, stat } from "node:fs/promises";
import path from "node:path";
import { SONG_FILE } from "@/lib/listen";
import { isProd, MUSIC_DIR } from "@/lib/server/env";
import { songsGoOut } from "@/lib/server/listen";
import { linkGood } from "@/lib/server/musicLinks";

/**
 * GET /music/<file>?k=…: a song's file (src/lib/server/musicLinks.ts) in development, checked as /api/listen/ok
 * checks it for Caddy, and read in the ranges the player asks for. On the live site Caddy serves the files and this
 * route answers 404 to everything, so a song never goes out through the app should Caddy be set up wrong.
 */

/** Whole files only up to this size: a song is asked for in ranges */
const WHOLE_MAX = 20_000_000;

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  if (isProd) return new Response("Not found", { status: 404 });
  const { file } = await params;
  if (!SONG_FILE.test(file)) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  if (!songsGoOut() || !linkGood(`/music/${file}${url.search}`)) return new Response("Forbidden", { status: 403 });
  const where = path.join(path.resolve(MUSIC_DIR), "files", file);
  const size = await stat(where).then((s) => (s.isFile() ? s.size : -1), () => -1);
  if (size < 0) return new Response("Not found", { status: 404 });

  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range ? Math.min(size - 1, range[2] ? Number(range[2]) : size - 1) : size - 1;
  if (start > end || (!range && size > WHOLE_MAX)) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const bytes = new Uint8Array(end - start + 1);
  const handle = await open(where, "r");
  try {
    await handle.read(bytes, 0, bytes.length, start);
  } finally {
    await handle.close();
  }
  return new Response(bytes, {
    status: range ? 206 : 200,
    headers: {
      "content-type": "audio/mp4",
      "accept-ranges": "bytes",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
      "cache-control": "private, max-age=43200",
    },
  });
}
