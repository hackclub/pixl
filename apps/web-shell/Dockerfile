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
WORKDIR /repo/apps/web-shell
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# apps/web-shell/node_modules is mostly symlinks into /repo/node_modules/.bun
# (bun's workspace store, since this install runs against the root
# package.json) - copying the app-level node_modules alone leaves those
# symlinks dangling, so the store has to come along too, at the same
# repo-root-relative path the symlinks point at.
COPY --from=build --chown=node:node /repo/node_modules /repo/node_modules
COPY --from=build --chown=node:node /repo/apps/web-shell/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/web-shell/.next ./.next
COPY --from=build --chown=node:node /repo/apps/web-shell/public ./public
COPY --from=build --chown=node:node /repo/apps/web-shell/next.config.ts /repo/apps/web-shell/package.json ./

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
