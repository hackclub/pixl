# Pixl Dashboard (pixl.hackclub.com). Build context is the REPO ROOT, not
# apps/pixl-dashboard: this app reads docs/ straight off the filesystem
# (lib/docs.ts) and imports packages/docs-engine as a workspace package, so
# both need to be inside the build context.
#
#   docker build -f apps/pixl-dashboard/Dockerfile .
FROM oven/bun:1.4.2 AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
# The root bun.lock covers every workspace, so a frozen install needs every
# workspace manifest present, not just this app's.
COPY apps/server/package.json apps/server/
COPY apps/internal-dashboard/package.json apps/internal-dashboard/
COPY apps/pixorpheus/package.json apps/pixorpheus/
COPY packages packages
COPY apps/pixl-dashboard apps/pixl-dashboard
RUN bun install --frozen-lockfile

COPY docs docs
# OG preview cards (public/docs/<slug>/og.png and public/<page>/og.png) are
# written before `next build` so they ship as static files.
RUN bun run packages/docs-engine/build.ts && bun run packages/docs-engine/build-previews.ts

# next build runs under Node, not Bun - Bun 1.3.13 crashes with SIGILL partway
# through the build. Everything above still runs fine under Bun.
FROM node:26-slim AS node-build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /repo /repo
RUN cd apps/pixl-dashboard && node node_modules/next/dist/bin/next build

FROM node:26-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# output: "standalone" (next.config.ts) traces the real runtime dependency
# graph into .next/standalone as concrete files. In this monorepo the tracer
# mirrors the workspace layout: .next/standalone/apps/pixl-dashboard/server.js
# is the entry point next to a root-level .next/standalone/node_modules - both
# must be copied together, preserving the structure.
COPY --from=node-build --chown=node:node /repo/apps/pixl-dashboard/.next/standalone ./

# Standalone mode does not copy .next/static or public/; add them back at the
# paths server.js expects relative to its own directory.
COPY --from=node-build --chown=node:node /repo/apps/pixl-dashboard/.next/static ./apps/pixl-dashboard/.next/static
COPY --from=node-build --chown=node:node /repo/apps/pixl-dashboard/public ./apps/pixl-dashboard/public
# lib/docs.ts reads the markdown at request time.
COPY --from=node-build --chown=node:node /repo/docs ./docs

USER node
EXPOSE 3000
CMD ["node", "apps/pixl-dashboard/server.js"]
