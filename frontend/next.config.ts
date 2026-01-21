import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/runs/:path*',
        destination: '/../runs/:path*',
      },
    ];
  },
};

export default nextConfig;
