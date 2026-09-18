# Build context is apps/dashboard (own bun.lock, no workspace deps).
#
# Every env var this app reads is server-side (Supabase service key, Slack, HCA
# secrets), so none of it is baked into the image - it is all injected at run
# time. Locally the app runs on 4900; in the container it follows PORT so it
# lines up with the other three services.

FROM oven/bun:1.3.13 AS deps
WORKDIR /app

# Not --frozen-lockfile: this app's bun.lock predates sharp being added to
# package.json, so a frozen install refuses to run. Regenerating the lockfile
# would be the real fix.
COPY package.json bun.lock ./
RUN bun install

# next build runs under Node, not Bun - Bun 1.3.13 crashes with SIGILL partway
# through this app's build. Dependencies are still installed with Bun above;
# only the build step itself moves to Node.
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
