# Build context is apps/server (this app has its own bun.lock and no workspace
# deps, so it installs standalone with --frozen-lockfile).
#
# Bun installs and runs tsc; the runtime stage is plain node because that is
# what `bun run start` does (node dist/index.js) and what packages/config's
# generated .js entry exists for.

FROM oven/bun:1.4.2 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Full node_modules, not a production prune: drizzle-kit and drizzle-orm are
# runtime deps here so `drizzle-kit migrate` can be run inside the pod, which is
# the only place the cluster-internal Postgres host resolves.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/drizzle.config.ts /app/package.json ./

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
