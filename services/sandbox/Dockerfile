# Ephemeral sandbox for installing, building and testing third-party code (PLAN §1.6, §5.4).
# No secrets are ever passed in. Verification steps run with --network none (or an internal network for E2E).
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1 \
    COREPACK_ENABLE_STRICT=0
RUN npm install -g pnpm@10.33.0 \
 && mkdir -p /pnpm-store /work && chown -R pwuser:pwuser /pnpm-store /work
USER pwuser
RUN pnpm config set store-dir /pnpm-store
WORKDIR /work
