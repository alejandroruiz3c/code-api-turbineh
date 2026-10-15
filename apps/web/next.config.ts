import type { NextConfig } from "next";
import {
  assertEngine,
  ENGINE_SPECIFIER,
  hasPrivateEngine,
  PRIVATE_ENGINE_RELATIVE,
} from "./orchestration.config.mjs";
import {
  assertDeciderEngine,
  DECIDER_ENGINE_SPECIFIER,
  deciderEngineTarget,
} from "./resource-decider.config.mjs";

// Orchestration engine (ADR-0053): the private package when installed, else the public open fallback; production
// builds fail loudly without the private one.
assertEngine();
// Resource decision engine (ADR-0058): the private package when installed, else the public open fallback (never the
// Node loader); production builds fail loudly without the private one.
assertDeciderEngine();

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://github.com",
  "object-src 'none'",
].join("; ");

const config: NextConfig = {
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md/CLAUDE.md into apps/web; the repo keeps its own agent instructions.
  agentRules: false,
  images: { unoptimized: true },
  transpilePackages: [
    "@turbineh/db",
    "@turbineh/decider",
    "@turbineh/deployer",
    "@turbineh/engine",
    "@turbineh/orchestration",
    "@turbineh/shared",
    "@turbineh/storage",
  ],
  turbopack: {
    resolveAlias: {
      [DECIDER_ENGINE_SPECIFIER]: deciderEngineTarget(),
      ...(hasPrivateEngine() ? { [ENGINE_SPECIFIER]: PRIVATE_ENGINE_RELATIVE } : {}),
    },
  },
  serverExternalPackages: ["pg", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  // install.sh pins the published CLI version and SHA-256 (ADR-0055): its release.json travels with the function.
  outputFileTracingIncludes: { "/install.sh": ["./public/cli/release.json"] },
  // /cli and /docs were merged into /use (how to use: people, coding agents, API); old links land on their section.
  async redirects() {
    return [
      { source: "/cli", destination: "/use#agents", permanent: false },
      { source: "/docs", destination: "/use#api", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
