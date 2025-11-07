import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable experimental features that cause browser console warnings
  experimental: {
    // Disable features that might cause MediaSession warnings
  },
  // Ensure proper handling of development mode
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
