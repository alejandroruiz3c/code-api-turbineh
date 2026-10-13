import type { NextConfig } from "next";
import { securityHeaders } from "./src/security/headers";
import { SERVER_ACTION_BODY_LIMIT } from "./src/server/body-limit";

const config: NextConfig = {
  poweredByHeader: false,
  // No server-side image optimization: removes sharp/libvips (LGPL) and the optimizer's network surface.
  images: { unoptimized: true },
  // Largest form submission (file uploads go through server actions); limits are enforced again in code.
  experimental: { serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default config;
