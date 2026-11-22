import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // gzip buffers the proxied SSE stream in dev; FastAPI serves production.
  compress: false,
  // Separate build dirs so a running `next dev` never holds locks on files `next build` needs
  // (Windows file locking). NEXT_DIST_DIR overrides, e.g. to sidestep a stale locked .next/.
  distDir: process.env.NEXT_DIST_DIR ?? (isDev ? ".next-dev" : ".next"),
  // Static export for production (served by FastAPI); dev server proxies /api/* to the backend.
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
        },
      }
    : { output: "export" as const, images: { unoptimized: true }, trailingSlash: false }),
};

export default nextConfig;
