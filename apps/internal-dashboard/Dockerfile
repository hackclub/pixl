# Build context is apps/internal-dashboard (own bun.lock, no workspace deps).
#
# Every env var this app reads is server-side (DATABASE_URL, Slack, HCA
# secrets), so none of it is baked into the image - it is all injected at run
# time. Locally the app runs on 4900; in the container it follows PORT so it
# lines up with the other three services.

FROM oven/bun:1.4.2 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# next build runs under Node, not Bun - Bun 1.3.13 crashes with SIGILL partway
# through this app's build. Dependencies are still installed with Bun above;
# only the build step itself moves to Node.
FROM node:26-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# One id per build for next.config's deploymentId (version skew protection).
# A file rather than an env var so `next start` reads the same value.
RUN echo "b$(date +%s)" > .deployment-id && node node_modules/next/dist/bin/next build

FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts /app/package.json /app/.deployment-id ./

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
