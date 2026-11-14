# Build context is the repo root, not apps/game (paths below are repo-relative).
#
# Exports the Godot project for the web and serves only that export with
# serve.ts at play.pixl.hackclub.com. There are no player pages in this image:
# they all live on the Pixl Dashboard (pixl.hackclub.com).

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

# The exported index.html is written by Godot; add link-preview meta so a shared
# play link unfurls with the name and tagline. Values come from the synced
# pixl.json.
RUN set -eux; \
    PLAY="$(sed -n 's/.*"play": "\([^"]*\)".*/\1/p' apps/game/pixl.json)"; \
    TAGLINE="$(sed -n 's/.*"tagline": "\([^"]*\)".*/\1/p' apps/game/pixl.json)"; \
    META="<meta name=\"description\" content=\"${TAGLINE}\">\
<meta property=\"og:type\" content=\"website\">\
<meta property=\"og:site_name\" content=\"Pixl\">\
<meta property=\"og:title\" content=\"Pixl\">\
<meta property=\"og:description\" content=\"${TAGLINE}\">\
<meta property=\"og:url\" content=\"${PLAY}/\">\
<meta name=\"twitter:card\" content=\"summary\">\
<meta name=\"twitter:title\" content=\"Pixl\">\
<meta name=\"twitter:description\" content=\"${TAGLINE}\">"; \
    sed -i "s|</title>|</title>${META}|" /out/index.html; \
    grep -q 'og:title' /out/index.html

FROM oven/bun:1.4.2 AS runtime
WORKDIR /srv/app
ENV NODE_ENV=production
ENV PORT=3000
ENV SITE_ROOT=/srv/site

COPY --from=godot --chown=bun:bun /out /srv/site
COPY --chown=bun:bun apps/game/serve.ts ./serve.ts

USER bun
EXPOSE 3000
CMD ["bun", "run", "serve.ts"]
