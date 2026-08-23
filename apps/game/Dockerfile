# Build context is the repo root, not apps/game: the shell's link-preview
# cards are generated out of packages/docs-engine/ (docs pages themselves
# moved to apps/web-shell, its own Dockerfile - this app no longer touches
# docs/ at all).
#
# This is .github/workflows/deploy-game.yml as a container - same Godot version,
# same export preset, same shell assembly - with serve.ts standing in for the
# rewrites and headers vercel.json used to apply.

FROM debian:bookworm-slim AS godot
ARG GODOT_VERSION=4.6
ARG GODOT_RELEASE=stable

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip \
      libx11-6 libxcursor1 libxinerama1 libxrandr2 libxi6 libxext6 \
      libgl1 libglu1-mesa libasound2 libfontconfig1 libudev1 \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    BASE="https://github.com/godotengine/godot-builds/releases/download/${GODOT_VERSION}-${GODOT_RELEASE}"; \
    curl -fSL -o /tmp/godot.zip "${BASE}/Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_linux.x86_64.zip"; \
    curl -fSL -o /tmp/templates.tpz "${BASE}/Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_export_templates.tpz"; \
    cd /tmp; \
    unzip -q godot.zip; \
    unzip -q templates.tpz; \
    mv "Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_linux.x86_64" /usr/local/bin/godot; \
    chmod +x /usr/local/bin/godot; \
    mkdir -p "/root/.local/share/godot/export_templates/${GODOT_VERSION}.${GODOT_RELEASE}"; \
    mv templates/* "/root/.local/share/godot/export_templates/${GODOT_VERSION}.${GODOT_RELEASE}/"; \
    rm -rf /tmp/godot.zip /tmp/templates.tpz /tmp/templates

WORKDIR /repo
COPY apps/game apps/game

# Importing writes the .godot/ resource cache the export then reads. It reports
# failures for editor-only bits that don't matter headless, hence the `|| true`.
RUN godot --headless --path apps/game --import --quit-after 200 || true

# Absolute output path: with --path, Godot resolves a relative export target
# against the project dir, not the working directory.
RUN mkdir -p /out \
    && godot --headless --path apps/game --export-release Web /out/index.html \
    && test -f /out/index.html

# previews:build writes into apps/game/web/, so it has to run before the
# shell is copied into the site. No dependency beyond Bun's stdlib, so there
# is nothing to install. docs:build no longer runs here - /docs is now
# apps/web-shell (its own Dockerfile, its own OG cards); this app doesn't
# carry a docs/ shell anymore at all.
FROM oven/bun:1.3.13 AS shell
WORKDIR /repo
COPY package.json ./
COPY packages packages
COPY apps/game/web apps/game/web
COPY apps/game/assets apps/game/assets
RUN bun run previews:build && test -f apps/game/web/dashboard/og.png

FROM debian:bookworm-slim AS assemble
WORKDIR /site
COPY --from=godot /out/ ./
COPY --from=shell /repo/apps/game/web/. ./
COPY --from=shell /repo/apps/game/assets/fonts/Monocraft.ttf ./fonts/Monocraft.ttf
COPY --from=shell /repo/apps/game/assets/npcs/cheetah_char.png ./img/cheetah_char.png
COPY --from=shell /repo/apps/game/assets/ui/pixel_currency_red.png ./img/pixel.png
# api/ is TypeScript that serve.ts imports directly - serving it as static
# files would just hand out the source.
RUN rm -f .gdignore vercel.json && rm -rf api

# The exported index.html is written by Godot, so it is the one page previews:build
# cannot inject into - without this the game itself is the only link on the site
# that unfurls with no card at all. Values come from the synced pixl.json, taken
# straight from the build context: the shell stage only copies web/ and assets/.
COPY apps/game/pixl.json /tmp/pixl.json
RUN set -eux; \
    SITE="$(sed -n 's/.*"site": "\([^"]*\)".*/\1/p' /tmp/pixl.json)"; \
    TAGLINE="$(sed -n 's/.*"tagline": "\([^"]*\)".*/\1/p' /tmp/pixl.json)"; \
    META="<meta name=\"description\" content=\"${TAGLINE}\">\
<meta property=\"og:type\" content=\"website\">\
<meta property=\"og:site_name\" content=\"Pixl\">\
<meta property=\"og:title\" content=\"Pixl\">\
<meta property=\"og:description\" content=\"${TAGLINE}\">\
<meta property=\"og:url\" content=\"${SITE}/play\">\
<meta property=\"og:image\" content=\"${SITE}/og.png\">\
<meta property=\"og:image:width\" content=\"1200\">\
<meta property=\"og:image:height\" content=\"630\">\
<meta name=\"twitter:card\" content=\"summary_large_image\">\
<meta name=\"twitter:title\" content=\"Pixl\">\
<meta name=\"twitter:description\" content=\"${TAGLINE}\">\
<meta name=\"twitter:image\" content=\"${SITE}/og.png\">"; \
    sed -i "s|</title>|</title>${META}|" index.html; \
    rm -f /tmp/pixl.json; \
    grep -q 'og:image' index.html

FROM oven/bun:1.3.13 AS runtime
WORKDIR /srv/app
ENV NODE_ENV=production
ENV PORT=3000
ENV SITE_ROOT=/srv/site

COPY --from=assemble --chown=bun:bun /site /srv/site
COPY --chown=bun:bun apps/game/serve.ts ./serve.ts
COPY --chown=bun:bun apps/game/web/api ./web/api
# The api handlers read the server URL from ../../pixl.json, so the layout under
# /srv/app has to match the repo's (apps/game/pixl.json next to web/).
COPY --chown=bun:bun apps/game/pixl.json ./pixl.json

USER bun
EXPOSE 3000
CMD ["bun", "run", "serve.ts"]
