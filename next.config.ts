import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  // the development badge would sit on top of the profile picture in the bottom-left corner
  devIndicators: false,
};

export default nextConfig;
