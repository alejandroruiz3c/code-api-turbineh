# Baseline agent image (ADR-0009): the same toolchain our builds are verified with (Node, pnpm 10.33, Playwright 1.63
# browsers, non-root user) plus Claude Code. Runs only in bench/, with ANTHROPIC_API_KEY as its only secret.
FROM turbineh/sandbox:1
USER root
RUN npm install -g @anthropic-ai/claude-code@2.1.283
USER pwuser
WORKDIR /work
