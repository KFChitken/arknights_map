import { fishArtFile } from "@/lib/server/fishArt";

/**
 * GET /fish-art/<file>.webp: one of 钓鳞's 方舟原物 pictures, from our own server (on the servers Caddy hands out the
 * folder's files itself; this is for a file it has not, and for running it here)
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const bytes = await fishArtFile((await params).file);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" },
  });
}
