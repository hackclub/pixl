# Build context is apps/pixorpheus.
#
# Bun-native with no build step - Bolt runs the TypeScript entry directly, so
# the image just needs the deps and the source. Bolt listens in HTTP mode
# (app.start(PORT)), so this needs an ingress for Slack events and for the
# dashboard's /api/external/tickets calls.
#
# --production is safe here: every @slack/web-api and @slack/types import in
# src/ is `import type`, which Bun erases, so nothing resolves them at runtime.
#
# The install is pinned by this app's own standalone bun.lock (not the root
# workspace lock - the build context is this folder). After changing
# package.json, regenerate it the same way as apps/server's: copy package.json
# to a temp dir, run `bun install` with this image's Bun version (1.3.13, so
# the lockfile format matches), check `bun install --frozen-lockfile`, and
# copy bun.lock back. CI verifies it stays in sync.

FROM oven/bun:1.4.2
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
RUN chown -R bun:bun /app

ENV NODE_ENV=production
ENV PORT=3000

USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
