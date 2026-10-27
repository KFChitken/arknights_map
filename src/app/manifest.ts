import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/rules";

/** Lets players put the site on their phone's home screen and open it without the browser bars. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: "看看你身边有多少舟P",
    start_url: "/",
    display: "standalone",
    lang: "zh-CN",
    background_color: "#1b1d22",
    theme_color: "#1b1d22",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // the roach sits inside the circle Android crops maskable icons to
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
