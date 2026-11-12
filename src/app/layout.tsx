import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { HTML_LANG } from "@/i18n";
import { pageLang } from "@/i18n/request";
import { wordsUrl } from "@/i18n/server";
import { siteName } from "@/lib/rules";
import "./globals.css";

export const generateMetadata = (): Metadata => ({
  title: siteName(),
  description: "看看你身边有多少舟P",
  // opened from the home screen, the page runs under a see-through status bar; globals.css keeps clear of it
  appleWebApp: { capable: true, title: siteName(), statusBarStyle: "black-translucent" },
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#1b1d22",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await pageLang();
  return (
    <html lang={HTML_LANG[lang]}>
      <body>
        {/* the page's words, before the app starts (src/i18n) */}
        <Script src={wordsUrl(lang)} strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
