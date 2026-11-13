import "server-only";
import type { MetadataRoute } from "next";
import { HTML_LANG, lang, T } from "@/i18n";
import { pathIn } from "@/i18n/lang";
import { siteName } from "@/lib/rules";

/**
 * Lets players put the site on their desktop or home screen and open it without the browser bars
 * (存到桌面, src/components/app/HomeScreen.tsx). The icons are a day map with the roach on it, the maskable
 * one a little smaller so all of it sits inside the circle Android crops to; the screenshots are what
 * Chrome's install window shows. In the language T is in: the English site's opens at /en and stays there.
 */
export function siteManifest(): MetadataRoute.Manifest {
  const home = pathIn("/", lang());
  return {
    id: home,
    name: siteName(),
    short_name: siteName(),
    description: T.server.site.description,
    start_url: home,
    scope: home,
    display: "standalone",
    lang: HTML_LANG[lang()],
    background_color: "#1b1d22",
    theme_color: "#1b1d22",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // what matters inside the circle Android crops maskable icons to
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/screenshot-wide.webp", sizes: "1280x800", type: "image/webp", form_factor: "wide", label: siteName() },
      { src: "/screenshot-narrow.webp", sizes: "1080x1920", type: "image/webp", form_factor: "narrow", label: siteName() },
    ],
  };
}
