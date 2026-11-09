import { readFile } from "node:fs/promises";
import path from "node:path";
import { AMIYA_DANCE, AMIYA_PICTURE, GUIDE_ART_DIR, MINGHE_PICTURE, PARTY_MUSIC, PERLICA_PICTURE, TALULAH_PICTURE } from "@/lib/server/env";

/** The guides' pictures (src/lib/guides.ts) and whether each is switched on; only these files are ever served */
const PICTURES: Record<string, { on: boolean; type: string }> = {
  "amiya.png": { on: AMIYA_PICTURE, type: "image/png" },
  "perlica.png": { on: PERLICA_PICTURE, type: "image/png" },
  "talulah.png": { on: TALULAH_PICTURE, type: "image/png" },
  "minghe.png": { on: MINGHE_PICTURE, type: "image/png" },
  // 阿米娅向导's dance: one 6.9-second loop, played when she is tapped, and the music of the video it comes from
  "amiya-dance.webp": { on: AMIYA_DANCE, type: "image/webp" },
  "amiya-dance.m4a": { on: AMIYA_DANCE, type: "audio/mp4" },
  // ⚡舟友的酒⚡'s minute of 「⚡邦友の酒⚡」 (src/lib/party.ts)
  "zhouyou-jiu.m4a": { on: PARTY_MUSIC, type: "audio/mp4" },
};

/** GET /guide-art/<guide>.png: a guide's picture, from the server's own folder; 404 while switched off. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  const picture = Object.prototype.hasOwnProperty.call(PICTURES, file) ? PICTURES[file] : null;
  const bytes = picture?.on ? await readFile(path.join(GUIDE_ART_DIR, file)).catch(() => null) : null;
  if (!picture || !bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": picture.type,
      "cache-control": "public, max-age=86400",
    },
  });
}
