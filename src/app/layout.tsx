import type { Metadata, Viewport } from "next";
import { SITE_NAME } from "@/lib/rules";
import "./globals.css";

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "看看你身边有多少舟p",
  // opened from the home screen, the page runs under a see-through status bar; globals.css keeps clear of it
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#1b1d22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
