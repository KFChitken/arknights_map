import { withLang } from "@/i18n/server";
import { siteManifest } from "@/lib/server/manifest";

/** The English site's manifest, EN_MANIFEST (src/app/manifest.ts has the Chinese one's). Not named manifest.*, which Next would take for the site's own */
export function GET() {
  return Response.json(withLang("en", siteManifest), { headers: { "content-type": "application/manifest+json" } });
}
