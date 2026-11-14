import { passArtFile } from "@/lib/server/passArt";

/** GET /operator-art/pass/<file>: a character's picture on passes, from our own server (Caddy sends them itself on the live site) */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const art = await passArtFile((await params).file);
  if (!art) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(art.bytes), {
    headers: { "content-type": art.type, "cache-control": "public, max-age=31536000, immutable" },
  });
}
