import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake heavy barrel libraries so only the pieces actually used are
  // bundled (keeps the lazy-loaded chart chunk small).
  experimental: {
    optimizePackageImports: ["recharts"],
  },
  async headers() {
    return [
      {
        // The service worker must never be HTTP-cached, or clients get stuck on
        // an old worker and miss updates.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Baseline security headers (safe defaults for this app).
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
