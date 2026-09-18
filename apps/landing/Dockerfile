# Build context is apps/landing (own bun.lock, no workspace deps).
#
# next start wants node, so deps are installed with bun and the built app runs
# on a node runtime. No NEXT_PUBLIC_* exist here, so nothing has to be baked in
# at build time: AIRTABLE_* are read server-side at request time.

FROM oven/bun:1.3.13 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# next build runs under Node, not Bun - Bun 1.3.13 crashes with SIGILL partway
# through the build (same issue apps/dashboard hit). Dependencies are still
# installed with Bun above; only the build step itself moves to Node.
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node node_modules/next/dist/bin/next build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts /app/package.json ./

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
