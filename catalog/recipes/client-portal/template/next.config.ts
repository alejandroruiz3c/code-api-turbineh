import type { NextConfig } from "next";
import { securityHeaders } from "./src/security/headers";

const config: NextConfig = {
  poweredByHeader: false,
  // No server-side image optimization: removes sharp/libvips (LGPL) and the optimizer's network surface.
  images: { unoptimized: true },
  // Client portal: file uploads up to 5 MB go through server actions (limit enforced again in code).
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default config;
