import type { MetadataRoute } from "next";
import "@/i18n/server";
import { siteManifest } from "@/lib/server/manifest";

/** The Chinese site's manifest (src/lib/server/manifest.ts; the English site's is /en/manifest.webmanifest) */
export default function manifest(): MetadataRoute.Manifest {
  return siteManifest();
}
