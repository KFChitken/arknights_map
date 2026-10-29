import { operatorArtFile } from "@/lib/server/operatorArt";

/** GET /operator-art/<file>.webp: a character's picture, from our own server so no visitor's address goes to a wiki. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const bytes = await operatorArtFile((await params).file);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" },
  });
}
