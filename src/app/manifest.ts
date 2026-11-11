import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/rules";

/**
 * Lets players put the site on their desktop or home screen and open it without the browser bars
 * (存到桌面, src/components/app/HomeScreen.tsx). The icons are a day map with the roach on it, the maskable
 * one a little smaller so all of it sits inside the circle Android crops to; the screenshots are what
 * Chrome's install window shows.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: "看看你身边有多少舟P",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "zh-CN",
    background_color: "#1b1d22",
    theme_color: "#1b1d22",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // what matters inside the circle Android crops maskable icons to
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/screenshot-wide.webp", sizes: "1280x800", type: "image/webp", form_factor: "wide", label: SITE_NAME },
      { src: "/screenshot-narrow.webp", sizes: "1080x1920", type: "image/webp", form_factor: "narrow", label: SITE_NAME },
    ],
  };
}
