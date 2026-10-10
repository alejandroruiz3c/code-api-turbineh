import type { NextConfig } from "next";
import { securityHeaders } from "./src/security/headers";

const config: NextConfig = {
  poweredByHeader: false,
  // No server-side image optimization: removes sharp/libvips (LGPL) and the optimizer's network surface.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default config;
