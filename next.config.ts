import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // the development badge would sit on top of the profile picture in the bottom-left corner
  devIndicators: false,
  // the site's pictures are plain <img> of files already small, so Next's own resizer (/_next/image) is off:
  // left on, anyone could have the process make and keep a copy of any of them at every size and quality
  images: { unoptimized: true },
  // the 管理台 is never kept by a browser or anything between, nor listed by search engines
  async headers() {
    const admin = [
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex" },
    ];
    return [
      { source: "/admin", headers: admin },
      { source: "/api/admin/:path*", headers: admin },
    ];
  },
};

export default nextConfig;
