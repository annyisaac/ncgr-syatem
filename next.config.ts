import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake heavy barrel libraries so only the pieces actually used are
  // bundled (keeps the lazy-loaded chart chunk small).
  experimental: {
    optimizePackageImports: ["recharts"],
  },
};

export default nextConfig;
