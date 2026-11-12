import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // the development badge would sit on top of the profile picture in the bottom-left corner
  devIndicators: false,
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
