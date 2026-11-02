import { readFile } from "node:fs/promises";
import path from "node:path";
import { AMIYA_PICTURE, GUIDE_ART_DIR } from "@/lib/server/env";

/** GET /guide-art/amiya.png: 阿米娅向导's picture, from the server's own folder (src/lib/amiya.ts); 404 while switched off. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  const bytes = AMIYA_PICTURE && file === "amiya.png" ? await readFile(path.join(GUIDE_ART_DIR, file)).catch(() => null) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
  });
}
