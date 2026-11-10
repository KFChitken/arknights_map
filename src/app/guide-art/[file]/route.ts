import { readFile } from "node:fs/promises";
import path from "node:path";
import { AMIYA_DANCE, AMIYA_PICTURE, GUIDE_ART_DIR, MINGHE_PICTURE, PARTY_MUSIC, PERLICA_PICTURE, TALULAH_PICTURE } from "@/lib/server/env";

/** The guides' pictures (src/lib/guides.ts) and whether each is switched on; only these files are ever served */
const PICTURES: Record<string, { on: boolean; type: string }> = {
  // WebP for pages now, PNG still for pages from before
  "amiya.webp": { on: AMIYA_PICTURE, type: "image/webp" },
  "perlica.webp": { on: PERLICA_PICTURE, type: "image/webp" },
  "talulah.webp": { on: TALULAH_PICTURE, type: "image/webp" },
  "minghe.webp": { on: MINGHE_PICTURE, type: "image/webp" },
  "amiya.png": { on: AMIYA_PICTURE, type: "image/png" },
  "perlica.png": { on: PERLICA_PICTURE, type: "image/png" },
  "talulah.png": { on: TALULAH_PICTURE, type: "image/png" },
  "minghe.png": { on: MINGHE_PICTURE, type: "image/png" },
  // 阿米娅向导's dance: one 6.9-second loop, played when she is tapped, and the music of the video it comes from
  "amiya-dance.webp": { on: AMIYA_DANCE, type: "image/webp" },
  "amiya-dance.m4a": { on: AMIYA_DANCE, type: "audio/mp4" },
  // ⚡舟友的酒⚡'s minute of 「⚡邦友の酒⚡」 (src/lib/party.ts)
  "zhouyou-jiu.m4a": { on: PARTY_MUSIC, type: "audio/mp4" },
  // the 向导 badges drawn with the guides' own pictures (src/lib/badges.ts pictureArt), full and mini; 满编小队 has all four
  ...badgeArt(["amiya", "amiya30"], AMIYA_PICTURE),
  ...badgeArt(["perlica", "perlica30"], PERLICA_PICTURE),
  ...badgeArt(["talulah", "fireside"], TALULAH_PICTURE),
  ...badgeArt(["minghe", "sevenstops"], MINGHE_PICTURE),
  ...badgeArt(["fullsquad"], AMIYA_PICTURE && PERLICA_PICTURE && TALULAH_PICTURE && MINGHE_PICTURE),
};

function badgeArt(ids: string[], on: boolean) {
  return Object.fromEntries(
    ids.flatMap((id) => [`badge-${id}.svg`, `badge-${id}-mini.svg`].map((file) => [file, { on, type: "image/svg+xml" }])),
  );
}

/** GET /guide-art/<file>: a guide's picture (or a badge drawn with it), from the server's own folder; 404 while switched off. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  const picture = Object.prototype.hasOwnProperty.call(PICTURES, file) ? PICTURES[file] : null;
  const bytes = picture?.on ? await readFile(path.join(GUIDE_ART_DIR, file)).catch(() => null) : null;
  if (!picture || !bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": picture.type,
      // a month: a new picture comes under a new ?v (src/lib/roachImages.ts)
      "cache-control": "public, max-age=2592000",
      // a picture, nothing more, even opened on its own
      ...(picture.type === "image/svg+xml" ? { "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'" } : {}),
    },
  });
}
