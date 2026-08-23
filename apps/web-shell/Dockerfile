# Build context is the repo root, not apps/web-shell: this app reads docs/
# straight off the filesystem (lib/docs.ts) and imports packages/docs-engine
# as a workspace package, so both need to be inside the build context - same
# reason apps/game/Dockerfile uses the repo root instead of its own app dir,
# and the opposite of apps/dashboard/Dockerfile's isolated apps/dashboard-only
# context (dashboard has no workspace-package dependency, this app does).
FROM oven/bun:1.3.13 AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
COPY packages packages
COPY apps/web-shell apps/web-shell
RUN bun install

COPY docs docs
# Writes apps/web-shell/public/docs/<slug>/og.png before `next build` runs,
# so the OG images end up as static files in the build output.
RUN bun run packages/docs-engine/build.ts
RUN cd apps/web-shell && bun run build

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# output: "standalone" (next.config.ts) makes `next build` run @vercel/nft to
# trace the real runtime dependency graph and write it as concrete files
# under .next/standalone, instead of the app-level node_modules' symlinks
# into bun's workspace store - that's what let the old approach's ~900MB
# /repo/node_modules copy be dropped entirely.
#
# In this monorepo the tracer nests its output to mirror the workspace
# layout rather than flattening it: .next/standalone/apps/web-shell/server.js
# is the real entry point, sitting next to a *root*-level
# .next/standalone/node_modules (hoisted deps) as well as its own
# apps/web-shell/node_modules (symlinks back into that root node_modules,
# relative to the standalone folder - both must be copied together,
# preserving this structure, for the symlinks to resolve).
COPY --from=build --chown=node:node /repo/apps/web-shell/.next/standalone ./

# Standalone mode does not copy .next/static or public/ (Next's docs say
# these are meant to be handled by a CDN) - both have to be added back
# manually, at the paths server.js expects relative to its own directory.
COPY --from=build --chown=node:node /repo/apps/web-shell/.next/static ./apps/web-shell/.next/static
COPY --from=build --chown=node:node /repo/apps/web-shell/public ./apps/web-shell/public

USER node
EXPOSE 3000
CMD ["node", "apps/web-shell/server.js"]
