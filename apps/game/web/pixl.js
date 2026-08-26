const Pixl = (() => {
  // <pixl-config>
  // GENERATED from packages/config/pixl.json by `bun run config:sync` - do not edit
  const config = {
    "name": "Pixl",
    "tagline": "A retro 2D world where you level up by building real things",
    "launchDate": "2026-08-18T11:00:00Z",
    "hackatimeCutoff": "2026-07-18T00:00:00Z",
    "urls": {
      "site": "https://pixl.hackclub.com",
      "play": "https://play.pixl.hackclub.com",
      "docs": "https://pixl.hackclub.com/docs",
      "server": "https://server.pixl.hackclub.com",
      "ws": "wss://server.pixl.hackclub.com/ws",
      "repo": "https://github.com/hackclub/pixl"
    },
    "economy": {
      "pixelValueUsd": 0.07,
      "sponsorRateUsd": 8.5,
      "basePayoutUsd": 3.5,
      "maxPayoutUsd": 6,
      "reForMaxPayout": 7500,
      "payoutSteps": [
        {
          "re": 0,
          "usd": 3.5
        },
        {
          "re": 1250,
          "usd": 3.75
        },
        {
          "re": 2500,
          "usd": 4
        },
        {
          "re": 3750,
          "usd": 4.5
        },
        {
          "re": 5000,
          "usd": 5
        },
        {
          "re": 6250,
          "usd": 5.5
        },
        {
          "re": 7500,
          "usd": 6
        }
      ],
      "tierRePerHour": [
        12.5,
        15,
        18.75,
        25
      ],
      "trialBonusRe": 100,
      "levelBands": [
        {
          "throughLevel": 10,
          "rePerLevel": 10
        },
        {
          "throughLevel": 50,
          "rePerLevel": 35
        },
        {
          "throughLevel": 100,
          "rePerLevel": 70
        }
      ]
    },
    "team": [
      "Gabin",
      "Ridit",
      "Ricky"
    ]
  };
  // </pixl-config>

  // Starting pixels-per-hour: the payout floor, before any Restoration Energy.
  // Quoted in the onboarding copy, which is why it's derived rather than typed
  // out - the rate has moved once already and the old "50 pixels" was left
  // stranded in three places.
  const BASE_PX_PER_HOUR = Math.round(config.economy.basePayoutUsd / config.economy.pixelValueUsd);

  // Payout math, ported from packages/config/sync.ts's TS template (the
  // canonical formula generated into every TS app). pixl.js isn't one of that
  // script's generated targets - like BASE_PX_PER_HOUR above, this is hand-kept
  // in sync with the same source rather than sync-generated.
  function rePerHour(tier) {
    const E = config.economy;
    const t = Math.min(Math.max(Math.trunc(tier) || 1, 1), E.tierRePerHour.length);
    return E.tierRePerHour[t - 1];
  }
  function reForHours(hours, tier) {
    const h = Number.isFinite(hours) ? Math.max(hours, 0) : 0;
    return h * rePerHour(tier);
  }
  // Flat step table, not a curve: E.payoutSteps is sorted ascending by RE,
  // rate is whichever step's threshold is the highest one still <= re.
  function payoutUsdPerHour(re) {
    const E = config.economy;
    const r = Math.max(re, 0);
    let usd = E.payoutSteps[0].usd;
    for (const step of E.payoutSteps) {
      if (r < step.re) break;
      usd = step.usd;
    }
    return usd;
  }
  // The rate for a ship: the step the player's lifetime RE sits at once this
  // ship's own RE is added in (reBefore -> reAfter) - RE banks forever, so
  // this pays the new step for all of this ship's hours, not just the ones
  // past the boundary.
  function averageUsdPerHourOver(reBefore, reAfter) {
    return payoutUsdPerHour(Math.max(reAfter, reBefore, 0));
  }
  function projectPayoutUsd(hours, tier, reBefore) {
    const E = config.economy;
    const h = Number.isFinite(hours) ? Math.max(hours, 0) : 0;
    const reAfter = reBefore + reForHours(h, tier);
    const raw = h * averageUsdPerHourOver(reBefore, reAfter);
    return Math.min(raw, h * E.maxPayoutUsd);
  }
  // The same total in pixels - what actually gets credited.
  function projectPayoutPx(hours, tier, reBefore) {
    return projectPayoutUsd(hours, tier, reBefore) / config.economy.pixelValueUsd;
  }

  // play.pixl.rsvp is the raw game origin; there the canonical host is the apex
  // pixl.rsvp, which proxies these same pages through vercel.json. Bounce direct
  // visitors to the apex so every link lives on one host. This is client-side and
  // host-keyed, so it can only fire on a direct play.* visit — never on the
  // proxied apex load (hostname there is pixl.rsvp), which is why it can't loop.
  //
  // Scoped to pixl.rsvp deliberately: only that domain has the apex proxy. The
  // hackclub.com deploy serves the game on its own host with no rewrites behind
  // the apex, so bouncing there strands visitors on a /play that doesn't exist.
  try {
    const h = location.hostname;
    if (h.indexOf("play.") === 0 && h.endsWith(".pixl.rsvp")) {
      const dest = (location.pathname === "/" || location.pathname === "") ? "/play" : location.pathname;
      location.replace(location.protocol + "//" + h.substring(5) + dest + location.search + location.hash);
    }
  } catch {}

  // Applied as early as possible (top of the IIFE) to minimize the flash of
  // the default theme before this loads. Shares the storage key with the docs
  // app's own inline head script so the choice is consistent across both.
  //
  // The key is versioned, and bumping it is how a theme change is forced on
  // people who already picked one: the old value is simply never read again,
  // so everyone lands on the current default once and their next pick is
  // stored fresh. Bumped to v2 on 2026-08-17 for the landing-look port.
  try {
    document.documentElement.dataset.theme = localStorage.getItem("pixl_theme_v2") || "light";
  } catch {
    document.documentElement.dataset.theme = "light";
  }

  // Swatch preview colors for the picker menu — CSS custom properties only
  // expose the *active* theme's values, so the other themes' panel/gold need
  // their own small copy here just to draw the dots. Keep in sync with
  // packages/theme/palette.json by eye; there's no runtime data feeding this.
  const THEMES = [
    { id: "light", label: "Pixl Paper", panel: "#f5eed2", gold: "#ec3750" },
    { id: "dark", label: "Pixl Ink", panel: "#171615", gold: "#ff6b4a" },
  ];

  function currentTheme() {
    return document.documentElement.dataset.theme || "light";
  }

  function setTheme(id) {
    document.documentElement.dataset.theme = id;
    try { localStorage.setItem("pixl_theme_v2", id); } catch {}
    syncThemeToggles();
  }

  function syncThemeToggles() {
    const active = currentTheme();
    document.querySelectorAll(".theme-picker").forEach((wrap) => {
      const btn = wrap.querySelector(".theme-toggle");
      const menu = wrap.querySelector(".theme-menu");
      if (!btn || !menu) return;
      btn.innerHTML = PALETTE_ICON;
      btn.setAttribute("aria-label", "Change theme (current: " + (THEMES.find((t) => t.id === active)?.label || active) + ")");
      menu.innerHTML = THEMES.map((t) => `
        <button class="theme-opt${t.id === active ? " active" : ""}" type="button" data-theme-id="${t.id}">
          <span class="swatch" style="background:${t.panel};box-shadow:inset 0 0 0 2px ${t.gold}"></span>
          <span>${t.label}</span>
        </button>`).join("");
      menu.querySelectorAll(".theme-opt").forEach((opt) => {
        opt.onclick = () => {
          setTheme(opt.dataset.themeId);
          menu.hidden = true;
          btn.setAttribute("aria-expanded", "false");
        };
      });
    });
  }

  const API = config.urls.server;
  // On the standalone play.* host the game is at the root; when the same build
  // is served under pixl.rsvp (via rewrites) it lives at /play. Keep the
  // "back to game" link pointing at the right place without a redirect.
  const GAME = location.hostname.startsWith("play.") ? "/" : "/play";

  // Same Hack Club Auth flow the game itself uses for a web login
  // (NetworkManager._start_login_web in the Godot client) - the server hands
  // the finished session back to whatever web_redirect points at, and the
  // token bootstrap above already picks up a ?token= on any page load, so a
  // signed-out visitor can log in right here without ever opening the game.
  function loginUrl() {
    return API + "/auth/hackclub?web_redirect=" + encodeURIComponent(location.origin + location.pathname);
  }

  const params = new URLSearchParams(location.search);
  let token = params.get("token") || "";
  if (token) {
    try { localStorage.setItem("pixl_token", token); } catch {}
    params.delete("token");
    params.delete("name");
    params.delete("embed");
    const qs = params.toString();
    history.replaceState({}, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  } else {
    try { token = localStorage.getItem("pixl_token") || ""; } catch {}
  }

  // Logging out in the game clears the shared session. Same origin, we hear it
  // through the storage event; on the play.* host the game can't touch our
  // localStorage, so it messages the window it opened instead.
  function signedOut() {
    if (!token) return;
    token = "";
    try { localStorage.removeItem("pixl_token"); } catch {}
    if (document.querySelector(".gate")) return;
    if (document.body) gate();
    else document.addEventListener("DOMContentLoaded", gate);
  }
  window.addEventListener("storage", (e) => {
    if (e.key === "pixl_token" && !e.newValue) signedOut();
  });
  window.addEventListener("message", (e) => {
    if (e.source === window.opener && e.data && e.data.pixl === "logout") signedOut();
  });

  // The in-game First Project guide opens the Builder Terminal with
  // ?onboard=first-project to launch its own project-creation walkthrough. Grab
  // the flag, then strip it from the URL so a manual refresh doesn't replay it.
  const firstProjectOnboard = params.get("onboard") === "first-project";
  if (params.has("onboard")) {
    params.delete("onboard");
    const oqs = params.toString();
    history.replaceState({}, "", location.pathname + (oqs ? "?" + oqs : "") + location.hash);
  }

  function phase() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 5 || h >= 21) return "night";
    if (h < 7) return "dawn";
    if (h < 17) return "day";
    return "dusk";
  }
  document.documentElement.dataset.phase = phase();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);
  }

  function gate() {
    document.body.insertAdjacentHTML("beforeend", `
      <div class="gate">
        <div class="gate-card">
          <img class="gate-splash" src="/img/boot-splash.png" alt="Pixl">
          <p>This page is part of the Pixl world. Hop into the game and walk up to the shop, an NPC, or press the shortcut key to open it with your account.</p>
          <a class="btn-enter" href="${GAME}">Enter the Game</a>
        </div>
      </div>`);
  }

  async function api(path) {
    const url = API + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
    const res = await fetch(url);
    if (res.status === 401) {
      try { localStorage.removeItem("pixl_token"); } catch {}
      if (!document.querySelector(".gate")) gate();
      throw new Error("unauthorized");
    }
    if (!res.ok) throw new Error("http_" + res.status);
    return res.json();
  }

  function apiUrl(path) {
    return API + path + (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
  }

  let toastSlot = null;
  function toast(text, bad = false) {
    if (!toastSlot) {
      toastSlot = document.createElement("div");
      toastSlot.className = "toast-slot";
      document.body.appendChild(toastSlot);
    }
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.textContent = text;
    toastSlot.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  async function send(method, path, body, opts = {}) {
    const res = await fetch(apiUrl(path), {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      // keepalive: survive a location.href navigation fired right after this
      // call (see setOnboarding) — a normal fetch gets aborted mid-flight by
      // the navigation, so the request never reaches the server.
      keepalive: !!opts.keepalive,
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, ...(json || {}) };
  }

  async function upload(file, opts = {}) {
    // opts.kind: "image" (default, /api/uploads) or "bom" (/api/uploads/bom,
    // a hardware ship's Bill of Materials CSV, see MAX_CSV_BYTES server-side).
    const isBom = opts.kind === "bom";
    // Must match MAX_MODERATE_BYTES in apps/server/src/imageModeration.ts (images)
    // or MAX_CSV_BYTES in apps/server/src/routes/uploads.ts (bom), those are the
    // hard server-side caps, so reject early instead of making the caller wait
    // on an upload that's guaranteed to 413.
    if (file && file.size > (isBom ? 2_000_000 : 15_000_000))
      throw new Error("file_too_large");
    const res = await fetch(apiUrl(isBom ? "/api/uploads/bom" : "/api/uploads"), {
      method: "POST",
      headers: { "Content-Type": file.type || (isBom ? "text/csv" : "image/png") },
      body: file,
    });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok || !json.url) {
      if (json && json.error === "image_rejected")
        throw new Error("That image was rejected: " + (json.reason || "inappropriate for Pixl") + ".");
      throw new Error((json && json.error) || "upload_failed");
    }
    return json.url;
  }

  // Grouped into little labeled shelves instead of one flat list — reads more
  // like a game menu ("PLAY" / "ECONOMY" / "YOU") than a nav dump. Mobile
  // collapses the groups back into one row (see .nav-group in pixl.css).
  const NAV_GROUPS = [
    {
      label: "PLAY",
      items: [
        ["dashboard", "OVERVIEW"],
        ["docs", "DOCS"],
        ["explore", "EXPLORE"],
        ["ideas", "IDEAS"],
        ["vault", "GOALS"],
        ["trials", "TRIALS"],
        // QUESTS is hidden from the dash for now — not ready for players.
        // Re-enable when it is.
        // ["quests", "QUESTS"],
        // STORY (The Chronicle) is disabled in the dash for now — the
        // storyline is surfaced through community goals instead. Re-enable
        // when it's ready.
        // ["timeline", "STORY"],
        ["projects", "PROJECTS"],
      ],
    },
    {
      label: "ECONOMY",
      items: [
        ["shop", "SHOP"],
        ["orders", "ORDERS"],
        ["collectibles", "COLLECT"],
        ["refers", "REFERS"],
        ["calc", "CALC"],
      ],
    },
    {
      label: "YOU",
      items: [
        ["report", "REPORT"],
        ["account", "ACCOUNT"],
      ],
    },
  ];

  // What the mobile dock shows without opening the MORE sheet. Four items plus
  // MORE fits a phone row at a readable size; the full ten did not.
  const MOBILE_PRIMARY = ["dashboard", "projects", "shop", "explore"];

  // Small inline pixel-art glyphs (no image assets) for the sidebar nav.
  //
  // All ten are whole-pixel <rect>s on a 16x16 grid, so they stay crisp at the
  // sidebar's small size and match the blocky HELP/SUN/MOON glyphs below.
  // Everything reads from the silhouette and the gaps between rects — never
  // paint "detail" on top of a filled shape, since it's all one currentColor
  // and the detail just disappears into the fill.
  const ICONS = {
    // house: roof over a body with a doorway punched out of the bottom
    dashboard: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="7" y="1" width="2" height="2"/><rect x="5" y="3" width="6" height="2"/><rect x="3" y="5" width="10" height="2"/><rect x="3" y="7" width="3" height="7"/><rect x="10" y="7" width="3" height="7"/><rect x="6" y="7" width="4" height="2"/></svg>`,
    // open book: two pages split by a full-height gutter, bound at the bottom
    docs: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="4" width="5" height="8"/><rect x="9" y="4" width="5" height="8"/><rect x="2" y="12" width="12" height="2"/></svg>`,
    // shopping bag: square body under an arched handle (the old one tapered,
    // which read as a trash can)
    shop: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="5" y="1" width="6" height="2"/><rect x="5" y="3" width="2" height="2"/><rect x="9" y="3" width="2" height="2"/><rect x="3" y="5" width="10" height="9"/></svg>`,
    // receipt: hollow frame so the two ruled lines inside actually show
    orders: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="10" height="2"/><rect x="3" y="12" width="10" height="2"/><rect x="3" y="2" width="2" height="12"/><rect x="11" y="2" width="2" height="12"/><rect x="6" y="6" width="4" height="2"/><rect x="6" y="9" width="4" height="2"/></svg>`,
    // person + plus: "bring a friend"
    refers: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="4" height="4"/><rect x="1" y="8" width="8" height="6"/><rect x="9" y="4" width="6" height="2"/><rect x="11" y="2" width="2" height="6"/></svg>`,
    // gem, stepped down to a point
    collectibles: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="8" height="2"/><rect x="2" y="5" width="12" height="2"/><rect x="4" y="7" width="8" height="2"/><rect x="6" y="9" width="4" height="2"/><rect x="7" y="11" width="2" height="2"/></svg>`,
    // compass: octagon ring around a hub (a diagonal needle just collided with
    // the ring and turned to mush at this size)
    explore: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="5" y="2" width="6" height="2"/><rect x="3" y="4" width="2" height="2"/><rect x="11" y="4" width="2" height="2"/><rect x="2" y="6" width="2" height="4"/><rect x="12" y="6" width="2" height="4"/><rect x="3" y="10" width="2" height="2"/><rect x="11" y="10" width="2" height="2"/><rect x="5" y="12" width="6" height="2"/><rect x="7" y="7" width="2" height="2"/></svg>`,
    // lightbulb, bulb on top and screw base below (the old one was upside down)
    ideas: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="5" y="1" width="6" height="1"/><rect x="4" y="2" width="8" height="6"/><rect x="5" y="8" width="6" height="1"/><rect x="6" y="10" width="4" height="2"/><rect x="6" y="13" width="4" height="2"/></svg>`,
    // app window with a title bar, hollow inside
    projects: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="12" height="2"/><rect x="2" y="5" width="2" height="8"/><rect x="12" y="5" width="2" height="8"/><rect x="2" y="11" width="12" height="2"/></svg>`,
    // flag on a pole
    report: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="2" height="12"/><rect x="5" y="3" width="8" height="6"/></svg>`,
    // head and shoulders
    account: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="5" y="2" width="6" height="5"/><rect x="3" y="9" width="10" height="5"/></svg>`,
    // vault door: hollow frame with a handwheel floating inside it
    vault: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="10" height="2"/><rect x="3" y="12" width="10" height="2"/><rect x="3" y="4" width="2" height="8"/><rect x="11" y="4" width="2" height="8"/><rect x="7" y="5" width="2" height="6"/><rect x="6" y="7" width="4" height="2"/></svg>`,
    // calculator: hollow body frame, a filled display up top, four buttons below
    calc: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="1" width="10" height="2"/><rect x="3" y="13" width="10" height="2"/><rect x="3" y="1" width="2" height="14"/><rect x="11" y="1" width="2" height="14"/><rect x="5" y="3" width="6" height="3"/><rect x="5" y="8" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="5" y="11" width="2" height="2"/><rect x="9" y="11" width="2" height="2"/></svg>`,
    // raffle ticket: hollow frame with a dashed tear-line down the middle
    trials: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="12" height="2"/><rect x="2" y="11" width="12" height="2"/><rect x="2" y="3" width="2" height="10"/><rect x="12" y="3" width="2" height="10"/><rect x="7" y="5" width="2" height="1"/><rect x="7" y="7" width="2" height="1"/><rect x="7" y="9" width="2" height="1"/></svg>`,
  };
  // Three-by-three grid, the "more" affordance on the mobile dock.
  const MORE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="3" height="3"/><rect x="7" y="2" width="3" height="3"/><rect x="12" y="2" width="2" height="3"/><rect x="2" y="7" width="3" height="3"/><rect x="7" y="7" width="3" height="3"/><rect x="12" y="7" width="2" height="3"/><rect x="2" y="12" width="3" height="2"/><rect x="7" y="12" width="3" height="2"/><rect x="12" y="12" width="2" height="2"/></svg>`;
  // Teal energy shard — the Restoration Energy motif, reused in the top rail.
  const RE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1l4 6-4 8-4-8z"/></svg>`;
  // Blocky pixel-art glyphs for the top-rail controls (help + theme toggle),
  // matching the sidebar nav icons instead of leaving these as raw text glyphs.
  const HELP_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="5" y="2" width="6" height="2"/><rect x="3" y="4" width="2" height="2"/><rect x="11" y="4" width="2" height="2"/><rect x="11" y="6" width="2" height="2"/><rect x="9" y="8" width="2" height="2"/><rect x="7" y="9" width="2" height="3"/><rect x="7" y="13" width="2" height="2"/></svg>`;
  // Blocky pixel-art paint palette — the theme-picker button's icon, one for
  // all themes rather than a sun/moon pair that only made sense for two.
  const PALETTE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="2" width="8" height="2"/><rect x="2" y="4" width="2" height="7"/><rect x="12" y="4" width="2" height="6"/><rect x="4" y="11" width="7" height="2"/><rect x="10" y="10" width="2" height="2"/><rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/><rect x="5" y="8" width="2" height="2"/></svg>`;

  function mountTopbar(active, opts) {
    // Pages that are meant to be publicly browsable (e.g. the shop) pass
    // guestNoShell: true to skip the sidebar/rail entirely for a signed-out
    // visitor, rather than showing the trimmed "LOG IN" rail every other page
    // gets — the page's own content is the whole story, chrome-free.
    if (opts && opts.guestNoShell && !token) return;
    const navLink = (slug, label, extra) =>
      `<a href="/${slug}/" class="${slug === active ? "active" : ""}${extra ? " " + extra : ""}"><span class="ic">${ICONS[slug] || ""}</span><span>${label}</span></a>`;
    const nav = NAV_GROUPS.map(
      (group) => `
        <div class="nav-group">
          <div class="nav-label">${group.label}</div>
          ${group.items
            .map(([slug, label]) =>
              navLink(slug, label, MOBILE_PRIMARY.includes(slug) ? "" : "secondary"),
            )
            .join("")}
        </div>`,
    ).join("");
    // The mobile dock is one 60px row, so it only carries MOBILE_PRIMARY plus a
    // MORE button; everything else lives in a sheet that slides up from it.
    // These are a second copy of the same links rather than the same nodes
    // moved around, since the dock and the sheet are visible at once.
    const overflow = NAV_GROUPS.flatMap((g) =>
      g.items.filter(([slug]) => !MOBILE_PRIMARY.includes(slug)),
    );
    const sheet = `
      <button class="nav-more" id="pixl-more" type="button" aria-expanded="false" aria-controls="pixl-sheet">
        <span class="ic">${MORE_ICON}</span><span>MORE</span>
      </button>
      <div class="nav-sheet" id="pixl-sheet" hidden>
        <div class="nav-sheet-grid">
          ${overflow.map(([slug, label]) => navLink(slug, label)).join("")}
        </div>
      </div>`;
    // Signed-out visitors (e.g. someone reading the public docs) get a trimmed
    // rail: no wallet, no tour replay, and the CTA invites them into the game.
    // A picker offering exactly one theme is just a dead button, so it only
    // renders once there's an actual choice to make.
    const themeBtn = THEMES.length < 2 ? "" : `
      <div class="theme-picker" id="pixl-theme-picker">
        <button class="theme-toggle" id="pixl-theme-btn" type="button" title="Change theme" aria-expanded="false"></button>
        <div class="theme-menu" id="pixl-theme-menu" hidden></div>
      </div>`;
    const rail = token
      ? `<div class="rest-chip" id="pixl-rest" title="Core Integrity: the community's Restoration progress" hidden>
            <span class="slot">${RE_ICON}</span>
            <span class="re">-</span>
            <span class="rl">CORE</span>
          </div>
          <div class="wallet-chip" id="pixl-wallet" title="Your pixels">
            <span class="slot"><img src="/img/pixel.png" alt="px"></span>
            <span class="px">-</span>
          </div>
          <button class="rail-btn" id="pixl-help-btn" type="button" title="New here? Replay the tour" aria-label="Replay the tour">${HELP_ICON}</button>
          ${themeBtn}`
      : `<a class="btn" href="${loginUrl()}">LOG IN</a><a class="btn ghost" href="${GAME}">PLAY THE GAME</a>${themeBtn}`;
    const foot = token
      ? `<a class="btn dark back-to-game" href="${GAME}"><span class="arrow">◄</span> BACK TO GAME</a>`
      : `<a class="btn" href="${loginUrl()}">LOG IN</a>`;
    document.body.classList.add("has-sidebar");
    document.body.insertAdjacentHTML("afterbegin", `
      <aside class="sidebar">
        <a class="sb-logo" href="${GAME}" title="Back to the game">PIXL</a>
        <nav class="nav">${nav}${sheet}</nav>
        <div class="sb-foot">${foot}</div>
      </aside>
      <div class="toprail">${rail}</div>`);
    const help = document.getElementById("pixl-help-btn");
    if (help) help.onclick = () => runTour();
    const more = document.getElementById("pixl-more");
    const sheetEl = document.getElementById("pixl-sheet");
    if (more && sheetEl) {
      const setOpen = (open) => {
        sheetEl.hidden = !open;
        more.classList.toggle("open", open);
        more.setAttribute("aria-expanded", String(open));
      };
      more.onclick = (e) => {
        e.stopPropagation();
        setOpen(sheetEl.hidden);
      };
      // Any tap outside the sheet closes it, including on a link inside it
      // (which navigates anyway).
      document.addEventListener("click", (e) => {
        if (!sheetEl.hidden && !sheetEl.contains(e.target)) setOpen(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !sheetEl.hidden) setOpen(false);
      });
    }
    const themeBtnEl = document.getElementById("pixl-theme-btn");
    const themeMenuEl = document.getElementById("pixl-theme-menu");
    if (themeBtnEl && themeMenuEl) {
      const setMenuOpen = (open) => {
        themeMenuEl.hidden = !open;
        themeBtnEl.setAttribute("aria-expanded", String(open));
      };
      themeBtnEl.onclick = (e) => {
        e.stopPropagation();
        setMenuOpen(themeMenuEl.hidden);
      };
      document.addEventListener("click", (e) => {
        if (!themeMenuEl.hidden && !themeMenuEl.contains(e.target) && e.target !== themeBtnEl) setMenuOpen(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !themeMenuEl.hidden) setMenuOpen(false);
      });
    }
    syncThemeToggles();
    // Auto-run the walkthrough once, on whichever dash page a newcomer lands on.
    maybeOnboard();
  }

  async function loadWallet() {
    const el = document.getElementById("pixl-wallet");
    // Kick off the collective Core Integrity chip alongside the personal wallet.
    loadRestoration();
    if (!el) return null;
    try {
      const w = await api("/api/profile/wallet");
      if (!w.ok) return null;
      el.querySelector(".px").textContent = Math.round(w.pixels).toLocaleString();
      return w;
    } catch {
      return null;
    }
  }

  // Fills the teal "Core Integrity" chip from the live community goal, if one is
  // running. No active goal → the chip stays hidden (never shows fake data).
  async function loadRestoration() {
    const el = document.getElementById("pixl-rest");
    if (!el) return null;
    try {
      const d = await api("/api/events/active");
      const goal = (d.events || []).find(
        (e) => e.type === "community_goal" && Number(e.target) > 0,
      );
      if (!goal) return null;
      const pct = Math.max(0, Math.min(100, Math.round((goal.progress / goal.target) * 100)));
      el.querySelector(".re").textContent = pct + "%";
      el.removeAttribute("hidden");
      return goal;
    } catch {
      return null;
    }
  }

  // Godot RichTextLabel BBCode subset → HTML.
  // https://docs.godotengine.org/en/latest/tutorials/ui/bbcode_in_richtextlabel.html
  function bbSafeColor(v) {
    return /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{2,24})$/.test(v) ? v : "";
  }

  function bbSafeUrl(v) {
    return /^https?:\/\/[^"'\s]+$/i.test(v) ? v : "";
  }

  function bbChars(cls, inner) {
    if (inner.includes("<")) return `<span class="${cls}">${inner}</span>`;
    const chars = inner.match(/&[^;\s]{1,10};|[\s\S]/g) || [];
    return `<span class="${cls}">${chars.map((c, i) =>
      `<span class="bb-char" style="animation-delay:-${(i * 0.09).toFixed(2)}s">${c}</span>`,
    ).join("")}</span>`;
  }

  const BB_RULES = [
    [/\[b\]([\s\S]*?)\[\/b\]/g, "<b>$1</b>"],
    [/\[i\]([\s\S]*?)\[\/i\]/g, "<i>$1</i>"],
    [/\[u\]([\s\S]*?)\[\/u\]/g, "<u>$1</u>"],
    [/\[s\]([\s\S]*?)\[\/s\]/g, "<s>$1</s>"],
    [/\[code\]([\s\S]*?)\[\/code\]/g, '<span class="bb-code">$1</span>'],
    [/\[center\]([\s\S]*?)\[\/center\]/g, '<span style="display:block;text-align:center">$1</span>'],
    [/\[right\]([\s\S]*?)\[\/right\]/g, '<span style="display:block;text-align:right">$1</span>'],
    [/\[left\]([\s\S]*?)\[\/left\]/g, '<span style="display:block;text-align:left">$1</span>'],
    [/\[color=([^\]]+)\]([\s\S]*?)\[\/color\]/g,
      (_m, c, inner) => bbSafeColor(c) ? `<span style="color:${bbSafeColor(c)}">${inner}</span>` : inner],
    [/\[bgcolor=([^\]]+)\]([\s\S]*?)\[\/bgcolor\]/g,
      (_m, c, inner) => bbSafeColor(c) ? `<span style="background:${bbSafeColor(c)}">${inner}</span>` : inner],
    [/\[font_size=(\d{1,3})\]([\s\S]*?)\[\/font_size\]/g,
      (_m, n, inner) => `<span style="font-size:${Math.min(Math.max(Number(n), 8), 64)}px">${inner}</span>`],
    [/\[url\](https?:\/\/[^\[\s]+)\[\/url\]/g,
      (_m, u) => bbSafeUrl(u) ? `<a href="${u}" target="_blank" rel="noopener">${u}</a>` : u],
    [/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/g,
      (_m, u, inner) => bbSafeUrl(u) ? `<a href="${bbSafeUrl(u)}" target="_blank" rel="noopener">${inner}</a>` : inner],
    [/\[img(?:[^\]]*)\](https?:\/\/[^\[\s]+)\[\/img\]/g,
      (_m, u) => bbSafeUrl(u) ? `<img class="bb-img" src="${u}" alt="" loading="lazy" onerror="this.remove()">` : ""],
    [/\[wave(?:[^\]]*)\]([\s\S]*?)\[\/wave\]/g, (_m, inner) => bbChars("bb-wave", inner)],
    [/\[shake(?:[^\]]*)\]([\s\S]*?)\[\/shake\]/g, (_m, inner) => bbChars("bb-shake", inner)],
    [/\[rainbow(?:[^\]]*)\]([\s\S]*?)\[\/rainbow\]/g, (_m, inner) => bbChars("bb-rainbow", inner)],
    [/\[tornado(?:[^\]]*)\]([\s\S]*?)\[\/tornado\]/g, (_m, inner) => bbChars("bb-wave", inner)],
    [/\[pulse(?:[^\]]*)\]([\s\S]*?)\[\/pulse\]/g, '<span class="bb-pulse">$1</span>'],
    [/\[fade(?:[^\]]*)\]([\s\S]*?)\[\/fade\]/g, '<span style="opacity:.55">$1</span>'],
  ];

  function bbcode(src) {
    let s = esc(src);
    for (let pass = 0; pass < 4; pass++) {
      const before = s;
      for (const [re, rep] of BB_RULES) s = s.replace(re, rep);
      if (s === before) break;
    }
    return s.replace(/\[lb\]/g, "&#91;").replace(/\[rb\]/g, "&#93;");
  }

  function bbstrip(src) {
    return String(src ?? "")
      .replace(/\[\/?(?!lb\]|rb\])[a-zA-Z][^\]]*\]/g, "")
      .replace(/\[lb\]/g, "[")
      .replace(/\[rb\]/g, "]");
  }

  // Safe Markdown subset for journals — escapes first, then renders headings,
  // bold/italic/strike, inline code + fenced blocks, links, images, lists,
  // blockquotes and rules. URLs are restricted to http(s).
  function mdInline(raw) {
    return esc(raw)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
        (_m, a, u) => (bbSafeUrl(u) ? `<img class="md-img" src="${u}" alt="${a}" loading="lazy" onerror="this.remove()">` : ""))
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        (_m, t, u) => (bbSafeUrl(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : t))
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>");
  }

  function markdown(src) {
    const lines = String(src ?? "").split(/\r?\n/);
    let html = "";
    let list = null;
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    for (let i = 0; i < lines.length; ) {
      const line = lines[i];
      if (/^```/.test(line)) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        html += `<pre class="md-pre"><code>${esc(buf.join("\n"))}</code></pre>`;
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { closeList(); html += `<h${h[1].length} class="md-h">${mdInline(h[2])}</h${h[1].length}>`; i++; continue; }
      if (/^\s*([-*_])\1\1+\s*$/.test(line)) { closeList(); html += `<hr class="md-hr">`; i++; continue; }
      if (/^>\s?/.test(line)) {
        closeList();
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
        html += `<blockquote class="md-quote">${mdInline(q.join(" "))}</blockquote>`;
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        if (list !== "ul") { closeList(); html += `<ul class="md-list">`; list = "ul"; }
        html += `<li>${mdInline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`; i++; continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        if (list !== "ol") { closeList(); html += `<ol class="md-list">`; list = "ol"; }
        html += `<li>${mdInline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`; i++; continue;
      }
      if (/^\s*$/.test(line)) { closeList(); i++; continue; }
      closeList();
      const para = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
        !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i]) &&
        !/^\s*([-*_])\1\1+\s*$/.test(lines[i])) para.push(lines[i++]);
      html += `<p class="md-p">${para.map(mdInline).join("<br>")}</p>`;
    }
    closeList();
    return html;
  }

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(s)) return "";
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function countdown(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (!isFinite(ms) || ms <= 0) return "gone!";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h left`;
    if (h > 0) return `${h}h ${m}m left`;
    return `${m}m ${s}s left`;
  }

  function hours(seconds) {
    return (seconds / 3600).toFixed(1) + "h";
  }

  /* ─────────────────────────── onboarding tour ───────────────────────────
   * A first-visit interactive walkthrough for people who've never heard of
   * Hack Club or Pixl. Each step is either a centered card (great for intro
   * copy + a short video/GIF) or a spotlight that highlights a real element on
   * the page and points a tooltip at it. Runs once, then remembers via
   * localStorage. EDIT ONBOARDING_STEPS to change the copy / media / targets.
   *
   * Step shape:
   *   { title, body, target?, video?, img? }
   *     target  CSS selector to spotlight (omit for a centered card)
   *     video   URL of a short .mp4/.webm to autoplay muted+looped in the card
   *     img     URL of a .gif/.png to show in the card instead of a video
   * A step whose target isn't on the current page falls back to a centered card.
   */
  // A hands-on "ship your first project" walkthrough — Pixo hands the player
  // here from the game, and this drives them through the actual create→ship flow
  // on the projects page (not a tour of the UI). Steps can carry:
  //   target   CSS selector to spotlight (omit → centered card)
  //   onNext   fn run when the player hits Next (e.g. open the editor for them)
  //   extra    { label, href } secondary button — used to detour into the docs;
  //            the tour is resumable so it picks back up when they return here.
  const ONBOARDING_STEPS = [
    {
      title: "Let's ship your first project",
      body: "This is your <b>Builder Terminal</b>, where every project lives. I'll walk you through making your first one and shipping it. Skip anytime.",
    },
    {
      target: "#new-btn",
      title: "Open a new project",
      body: "Hit <b>Next</b> and I'll open a fresh project for you.",
      onNext: () => document.getElementById("new-btn")?.click(),
    },
    {
      target: "#f-name",
      title: "Name it",
      body: "Say what you're building, like <b>“My portfolio site”</b> or <b>“Weather bot”</b>. Keep it short and real; you can rename it later.",
    },
    {
      target: "#f-repo",
      title: "Link your code",
      body: "Paste your <b>GitHub repo</b> here (and a live demo link below, if you have one) so a reviewer can actually see what you built. No repo yet? There's a Git guide in the docs.",
      extra: { label: "Git guide", href: "/docs/git" },
    },
    {
      target: "#ht-connect",
      title: "Track your time with Hackatime",
      body: `This is the important one. <b>Hackatime</b> logs the hours you spend building, and every shipped hour starts at <b>${BASE_PX_PER_HOUR} pixels</b>, climbing as you build up Restoration Energy. Connect it, then tick this project's boxes so your time counts.`,
      extra: { label: "New to Hackatime? Read this", href: "/docs/hackatime" },
    },
    {
      target: "#f-save",
      title: "Create it",
      body: "Save your project. Now go build it for real, come back whenever you've made progress and journal what you did.",
    },
    {
      target: "#s-ship",
      title: "Ship when it's ready",
      body: "Once it runs and you've logged at least <b>1 hour</b> on Hackatime, ship it for review. A reviewer credits you pixels + the prize. That's the whole loop.",
    },
    {
      title: "That's it, go build",
      body: "Not sure where to start? I wrote a step-by-step on making your first project. Hit <b>Done</b> and get to it, right here in the Builder Terminal.",
      extra: { label: "Build your first project →", href: "/docs/first-project" },
    },
  ];

  // The NEW-onboarding walkthrough — launched explicitly by the in-game First
  // Project guide (?onboard=first-project), separate from the counter-synced
  // auto-tour above. It only sets the project up (create → link → track); the
  // in-game checklist owns building and shipping, so this ends by sending the
  // player back to the game rather than marking them fully onboarded.
  //
  // Built per-run so it can speak to the specific Trial the player took on (from
  // Ridit): when a Trial is active it drops in a "what to build" brief and points
  // the naming/closing steps at that Trial. With no Trial it's the generic first
  // project. The player is always free to build their own thing instead.
  function firstProjectSteps(trial) {
    const t = trial;
    const intro = t
      ? {
          title: "Let's build your Trial",
          body: `Pixo sent you over. You're building for <b>${esc(t.name)}</b>, this is your <b>Builder Terminal</b>. I'll get the project set up here, then you build it to the brief. Pop back to the game anytime; the checklist keeps your place.`,
        }
      : {
          title: "Let's make your first project",
          body: "Pixo sent you over. This is your <b>Builder Terminal</b>, I'll get your first project set up here. Pop back to the game anytime; the checklist there keeps your place.",
        };
    const brief = t
      ? [
          {
            title: "What to build",
            body: `<b>${esc(t.name)}</b>${t.region ? " · " + esc(t.region) : ""}<br><br>${esc(t.description || "")}${t.reward ? `<br><br><b>Reward:</b> ${esc(t.reward)}` : ""}<br><br>Build to this, you'll flag it for the Trial when you ship.`,
          },
        ]
      : [];
    const nameStep = t
      ? {
          target: "#f-name",
          title: "Name it",
          body: `Name your project for the Trial, something like <b>“${esc(t.name)}”</b>. Short and real; you can rename it later.`,
        }
      : {
          target: "#f-name",
          title: "Name it",
          body: "Say what you're building, like <b>“My portfolio site”</b>. Short and real; you can rename it later.",
        };
    const closing = t
      ? {
          title: "Now go build it",
          body: `Head back into the game whenever, your <b>First Trial</b> checklist tracks the rest (build it, then ship it for <b>${esc(t.name)}</b>). Want a starting point? I wrote a first-site walkthrough with code.`,
          extra: { label: "First site (code) →", href: "/docs/first-site" },
        }
      : {
          title: "Now go build it",
          body: "Head back into the game whenever, your <b>First Project</b> checklist tracks the rest (build it, then ship it). Want a starting point? I wrote the whole first site out for you, code and all.",
          extra: { label: "Your first site (code) →", href: "/docs/first-site" },
        };
    return [
      intro,
      ...brief,
      {
        target: "#new-btn",
        title: "Open a new project",
        body: "Hit <b>Next</b> and I'll open a fresh project for you.",
        onNext: () => document.getElementById("new-btn")?.click(),
      },
      nameStep,
      {
        target: "#f-repo",
        title: "Link your code",
        body: "Paste your <b>GitHub repo</b> here (and a demo link below, if you have one) so a reviewer can see what you built. No repo yet? There's a Git guide.",
        extra: { label: "Git guide", href: "/docs/git" },
      },
      {
        target: "#ht-connect",
        title: "Track your time with Hackatime",
        body: "The important one. <b>Hackatime</b> logs your build hours, and every shipped hour becomes <b>50 pixels</b>. Connect it, then tick this project's boxes so the time counts.",
        extra: { label: "New to Hackatime? Read this", href: "/docs/hackatime" },
      },
      {
        target: "#f-save",
        title: "Create it",
        body: "Save your project. That's the first checklist item done, hop back to the game and Pixo will point you at what's next.",
      },
      closing,
    ];
  }

  // The Trial the player is currently building for: ?trial=<id> (Ridit hand-off)
  // or the single / most-recently accepted open Trial. null → generic first project.
  async function getActiveTrial() {
    try {
      const tid = Number(new URLSearchParams(location.search).get("trial"));
      const d = await api("/api/sidequests");
      const open = (d.quests || []).filter((q) => q.unlocked && !q.completed);
      if (tid) {
        const match = open.find((q) => Number(q.id) === tid);
        if (match) return match;
      }
      if (open.length === 0) return null;
      if (open.length === 1) return open[0];
      return (
        open.slice().sort((a, b) => {
          const ta = a.unlocked_at ? new Date(a.unlocked_at).getTime() : 0;
          const tb = b.unlocked_at ? new Date(b.unlocked_at).getTime() : 0;
          return tb - ta || Number(b.id) - Number(a.id);
        })[0] || null
      );
    } catch (e) {
      return null;
    }
  }

  function injectTourCSS() {
    if (document.getElementById("pixl-tour-css")) return;
    const s = document.createElement("style");
    s.id = "pixl-tour-css";
    s.textContent = `
      #pixl-tour{position:fixed;inset:0;z-index:99999;font-family:var(--sans)}
      #pixl-tour .pt-veil{position:absolute;inset:0;background:rgba(10,10,14,.5)}
      #pixl-tour .pt-hole{position:absolute;border-radius:0;box-shadow:0 0 0 9999px rgba(10,10,14,.5);transition:all .25s ease;pointer-events:none;border:var(--bw) solid var(--gold)}
      #pixl-tour .pt-card{position:absolute;max-width:340px;width:calc(100% - 32px);background:var(--panel);color:var(--ink);border:var(--bw) solid var(--stroke);border-radius:0;padding:18px;box-shadow:var(--drop);transition:top .2s ease,left .2s ease}
      #pixl-tour .pt-card.center{top:50%;left:50%;transform:translate(-50%,-50%)}
      #pixl-tour .pt-media{width:100%;border-radius:0;margin-bottom:12px;display:block;background:#000;aspect-ratio:16/9;object-fit:cover;border:var(--bw) solid var(--stroke)}
      #pixl-tour .pt-title{font-family:var(--pixel);font-size:18px;letter-spacing:.5px;color:var(--gold);margin-bottom:8px}
      #pixl-tour .pt-body{font-size:14px;line-height:1.55;color:var(--dim)}
      #pixl-tour .pt-body b{color:var(--ink)}
      #pixl-tour .pt-foot{display:flex;align-items:center;gap:10px;margin-top:16px}
      #pixl-tour .pt-dots{display:flex;gap:5px;margin-right:auto}
      #pixl-tour .pt-dot{width:7px;height:7px;border-radius:0;background:var(--muted)}
      #pixl-tour .pt-dot.on{background:var(--gold)}
      #pixl-tour .pt-skip{font-family:var(--sans);background:none;border:0;color:var(--faint);cursor:pointer;font-size:12px;padding:6px}
      #pixl-tour .pt-btn{font-family:var(--pixel);background:var(--gold);color:var(--btn-ink);border:var(--bw) solid var(--stroke);border-right-width:var(--bw-heavy);border-bottom-width:var(--bw-heavy);border-radius:0;padding:8px 16px;font-weight:600;letter-spacing:.5px;cursor:pointer;font-size:14px}
      #pixl-tour .pt-back{font-family:var(--pixel);background:var(--panel-2);border:var(--bw) solid var(--stroke);color:var(--dim);border-radius:0;padding:8px 12px;cursor:pointer;font-size:13px}
      #pixl-tour .pt-extra{display:block;width:100%;margin-top:12px;font-family:var(--pixel);background:none;border:var(--bw) solid var(--gold);color:var(--gold);border-radius:0;padding:8px 12px;cursor:pointer;font-size:13px;font-weight:700}
      #pixl-tour .pt-extra:hover{background:var(--gold);color:var(--btn-ink)}
    `;
    document.head.appendChild(s);
  }

  function markOnboarded() {
    try { localStorage.setItem("pixl_onboarded", "1"); } catch {}
  }

  // Shared cross-app onboarding counter (see apps/server .../profile.ts and
  // apps/game/scripts/guide_hud.gd). 0 = new, 1 = game intro done / dash pending,
  // 2 = fully onboarded.
  async function getOnboarding() {
    try { return await api("/api/profile/onboarding"); } catch { return null; }
  }
  function setOnboarding(step) {
    // Fire-and-forget; the counter is forward-only server-side so this is safe.
    // keepalive matters here: close() calls this right before a location.href
    // redirect, and without it the browser cancels the request mid-flight, so
    // the server never records step 2 and the tour just replays next visit.
    send("POST", "/api/profile/onboarding", { step }, { keepalive: true }).catch(() => {});
  }

  // Which tour step is in progress, so a docs detour resumes rather than restarts.
  const TOUR_STEP_KEY = "pixl_tour_step";
  function saveTourStep(n) { try { localStorage.setItem(TOUR_STEP_KEY, String(n)); } catch (e) {} }
  function clearTourStep() { try { localStorage.removeItem(TOUR_STEP_KEY); } catch (e) {} }
  function getTourStep() {
    try {
      const v = localStorage.getItem(TOUR_STEP_KEY);
      if (v == null) return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    } catch (e) { return null; }
  }

  // `sync` marks the shared onboarding as complete when the tour ends — used for
  // the auto-run (the dashboard leg of the game→dash journey), not the manual
  // "?" replay.
  function runTour(steps = ONBOARDING_STEPS, startAt = 0, sync = false) {
    injectTourCSS();
    document.getElementById("pixl-tour")?.remove();
    const root = document.createElement("div");
    root.id = "pixl-tour";
    root.innerHTML = `<div class="pt-veil"></div><div class="pt-hole" style="display:none"></div><div class="pt-card"></div>`;
    document.body.appendChild(root);
    const veil = root.querySelector(".pt-veil");
    const hole = root.querySelector(".pt-hole");
    const card = root.querySelector(".pt-card");
    let i = Math.max(0, Math.min(startAt, steps.length - 1));

    function close() {
      root.remove();
      markOnboarded();
      if (sync) {
        clearTourStep();
        setOnboarding(2); // dashboard leg done → fully onboarded
        // Done and Skip both just close the tour and leave the player on the
        // projects page — the whole point of finishing is to build there, so
        // bouncing them back to the game right after is the wrong move.
      }
    }
    // While a synced tour is live, remember which step we're on so a detour into
    // the docs (and ◄ BACK to this page) resumes here instead of restarting.
    function advance(to) {
      i = to;
      if (sync) saveTourStep(i);
      render();
    }

    function media(step) {
      if (step.video) return `<video class="pt-media" src="${esc(step.video)}" autoplay muted loop playsinline></video>`;
      if (step.img) return `<img class="pt-media" src="${esc(step.img)}" alt="">`;
      return "";
    }

    let placeTries = 0;
    function render() {
      const step = steps[i];
      if (sync) saveTourStep(i);
      const dots = steps.map((_, n) => `<span class="pt-dot ${n === i ? "on" : ""}"></span>`).join("");
      const extraBtn = step.extra ? `<button class="pt-extra">${esc(step.extra.label)}</button>` : "";
      card.innerHTML = `
        ${media(step)}
        <div class="pt-title">${esc(step.title)}</div>
        <div class="pt-body">${step.body}</div>
        ${extraBtn}
        <div class="pt-foot">
          <div class="pt-dots">${dots}</div>
          ${i < steps.length - 1 ? `<button class="pt-skip">Skip</button>` : ""}
          ${i > 0 ? `<button class="pt-back">Back</button>` : ""}
          <button class="pt-btn">${i === steps.length - 1 ? "Done" : "Next"}</button>
        </div>`;
      card.querySelector(".pt-btn").onclick = () => {
        try { step.onNext && step.onNext(); } catch (e) {}
        if (i === steps.length - 1) close();
        else advance(i + 1);
      };
      const back = card.querySelector(".pt-back");
      if (back) back.onclick = () => advance(i - 1);
      const skip = card.querySelector(".pt-skip");
      if (skip) skip.onclick = close;
      const extra = card.querySelector(".pt-extra");
      if (extra) extra.onclick = () => {
        // Detour (usually into the docs). Persist the *next* step so we resume
        // past this one when the player comes back to the projects page.
        if (sync) saveTourStep(Math.min(i + 1, steps.length - 1));
        if (step.extra.onClick) step.extra.onClick();
        else location.href = step.extra.href;
      };

      placeTries = 0;
      place(step);
    }

    // Position the spotlight. If the target isn't in the DOM yet (e.g. the editor
    // form is still rendering after we clicked "+ NEW PROJECT"), poll briefly
    // before falling back to a centered card.
    function place(step) {
      const el = step.target ? document.querySelector(step.target) : null;
      if (step.target && (!el || !el.getClientRects().length)) {
        if (placeTries++ < 20) { setTimeout(() => place(step), 100); return; }
      }
      if (el && el.getClientRects().length) {
        // Instant (not smooth) scroll so the element is at its final position by
        // the time we measure — a smooth scroll is still animating when we read
        // the rect, which left the spotlight offset from the real box.
        el.scrollIntoView({ block: "center", behavior: "instant" });
        // Measure on the next frame, after layout settles from the scroll.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          const pad = 6;
          hole.style.display = "block";
          hole.style.top = `${r.top - pad}px`;
          hole.style.left = `${r.left - pad}px`;
          hole.style.width = `${r.width + pad * 2}px`;
          hole.style.height = `${r.height + pad * 2}px`;
          card.classList.remove("center");
          const below = r.bottom + 14;
          const room = window.innerHeight - r.bottom;
          const cw = card.offsetWidth || 340;
          const ch = card.offsetHeight || 200;
          card.style.top = `${room > ch + 20 ? below : Math.max(14, r.top - ch - 14)}px`;
          card.style.left = `${Math.min(Math.max(14, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 14)}px`;
        }));
      } else {
        hole.style.display = "none";
        card.classList.add("center");
        card.style.top = "";
        card.style.left = "";
      }
    }
    // Clicking the dimmed backdrop is inert — the tour only closes via Skip/Done,
    // so a stray click outside the card doesn't drop the player out of onboarding.
    veil.onclick = null;
    render();
  }

  // Auto-run the "ship your first project" walkthrough. It drives the real
  // create→ship flow, so it only belongs on the projects page — that's also
  // where the in-game hand-off (WebPages.open("projects?from=game")) lands. If a
  // step is already saved (the player detoured into the docs and came back), we
  // resume there instead of restarting.
  async function maybeOnboard(steps = ONBOARDING_STEPS) {
    if (!token) return; // signed-out (public docs) never auto-runs
    if (!/\/projects(\/|$)/.test(location.pathname)) return;
    // New First Project guide hand-off: run its own self-contained walkthrough
    // and STOP — never also fire the old counter-synced auto-tour (which would
    // mark them fully onboarded and yank them back to the game mid-flow).
    if (firstProjectOnboard) {
      let shown = false;
      try { shown = sessionStorage.getItem("pixl_fp_shown") === "1"; } catch {}
      if (!shown) {
        try { sessionStorage.setItem("pixl_fp_shown", "1"); } catch {}
        const trial = await getActiveTrial();
        setTimeout(() => runTour(firstProjectSteps(trial), 0, false), 700);
      }
      return;
    }
    const saved = getTourStep();
    const ob = await getOnboarding();
    if (ob && ob.ok) {
      if (ob.done) { markOnboarded(); clearTourStep(); return; }
      const startAt = saved != null ? saved : 0;
      setTimeout(() => runTour(steps, startAt, true), 700);
      return;
    }
    // Server unreachable / pre-migration — fall back to the local guard.
    let done = true;
    try { done = localStorage.getItem("pixl_onboarded") === "1"; } catch (e) {}
    if (!done) setTimeout(() => runTour(steps, saved != null ? saved : 0, true), 700);
  }

  /* ─────────────────── custom confirm dialog ───────────────────
   * Drop-in async replacement for the browser's native confirm(). Returns a
   * Promise<boolean>. Usage: if (!(await Pixl.confirm({ title, body, danger }))) return;
   */
  function injectDialogCSS() {
    if (document.getElementById("pixl-dialog-css")) return;
    const s = document.createElement("style");
    s.id = "pixl-dialog-css";
    s.textContent = `
      .pxl-dialog{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:var(--sans)}
      .pxl-dialog .pxl-veil{position:absolute;inset:0;background:rgba(10,10,14,.66)}
      .pxl-dialog .pxl-box{position:relative;width:100%;max-width:400px;background:var(--panel);color:var(--ink);border:var(--bw) solid var(--stroke);border-radius:0;padding:20px;box-shadow:var(--drop-lg);animation:pxl-pop .16s ease}
      @keyframes pxl-pop{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}
      .pxl-dialog .pxl-t{font-family:var(--pixel);font-size:17px;color:var(--gold);margin-bottom:8px;letter-spacing:.5px}
      .pxl-dialog .pxl-b{font-size:14px;line-height:1.55;color:var(--dim)}
      .pxl-dialog .pxl-acts{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}
      .pxl-dialog button{font-family:var(--pixel);border-radius:0;padding:9px 16px;font-weight:600;font-size:13px;letter-spacing:.3px;cursor:pointer;border:var(--bw) solid var(--stroke);border-right-width:var(--bw-heavy);border-bottom-width:var(--bw-heavy);background:var(--panel-2);color:var(--dim)}
      .pxl-dialog .pxl-ok{background:var(--gold);color:var(--btn-ink)}
      .pxl-dialog .pxl-ok.danger{background:var(--bad);color:var(--btn-ink)}
      .pxl-dialog .pxl-mid{color:var(--teal);border-color:var(--teal)}
    `;
    document.head.appendChild(s);
  }

  function confirmDialog(opts = {}) {
    const {
      title = "Are you sure?",
      body = "",
      confirmText = "Confirm",
      cancelText = "Cancel",
      danger = false,
      // Optional third button (e.g. "Verify address") for a side action that
      // isn't a plain yes/no. Clicking it runs onMiddle() and closes the
      // dialog as if cancelled — callers doing something like a page
      // navigation in onMiddle don't need the promise to resolve true.
      middleText = "",
      onMiddle = null,
    } = opts;
    injectDialogCSS();
    return new Promise((resolve) => {
      const root = document.createElement("div");
      root.className = "pxl-dialog";
      root.tabIndex = -1;
      root.innerHTML = `
        <div class="pxl-veil"></div>
        <div class="pxl-box" role="dialog" aria-modal="true">
          <div class="pxl-t">${esc(title)}</div>
          ${body ? `<div class="pxl-b">${esc(body)}</div>` : ""}
          <div class="pxl-acts">
            <button class="pxl-cancel">${esc(cancelText)}</button>
            ${middleText ? `<button class="pxl-mid">${esc(middleText)}</button>` : ""}
            <button class="pxl-ok ${danger ? "danger" : ""}">${esc(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(root);
      const done = (v) => { root.remove(); resolve(v); };
      root.querySelector(".pxl-veil").onclick = () => done(false);
      root.querySelector(".pxl-cancel").onclick = () => done(false);
      root.querySelector(".pxl-ok").onclick = () => done(true);
      const mid = root.querySelector(".pxl-mid");
      if (mid) mid.onclick = () => { if (onMiddle) onMiddle(); done(false); };
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape") done(false);
        if (e.key === "Enter") done(true);
      });
      root.querySelector(".pxl-ok").focus();
    });
  }

  /**
   * Replaces a native <select>'s OS chrome (rounded corners, system arrow,
   * native popup) with a bordered button + our own dropdown, matching the
   * rest of the shell. The original <select> stays in the DOM (hidden, not
   * removed) as the source of truth: its value, its "change" event, and any
   * page code that already does $("f-kind").value or .addEventListener(
   * "change", ...) keep working untouched, this only changes what's drawn.
   */
  function enhanceSelect(sel) {
    if (sel.dataset.pixlEnhanced || sel.multiple) return;
    sel.dataset.pixlEnhanced = "1";

    const wrap = document.createElement("div");
    wrap.className = "csel";
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");

    const btn = document.createElement("button");
    btn.type = "button";
    const nativeClasses = [...sel.classList].filter((c) => c !== "field");
    btn.className = ["csel-btn", "field", ...nativeClasses].join(" ");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="csel-label"></span><span class="csel-arrow">▾</span>`;
    wrap.appendChild(btn);
    const label = btn.querySelector(".csel-label");

    const menu = document.createElement("div");
    menu.className = "csel-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    wrap.appendChild(menu);

    function buildMenu() {
      // Walk sel.children in document order rather than querying options and
      // optgroups separately - a select with both (like the Trial picker's
      // ungrouped "my own idea" option before its two optgroups) would
      // otherwise always render every optgroup first regardless of where the
      // loose options actually sit.
      menu.innerHTML = "";
      for (const child of sel.children) {
        if (child.tagName === "OPTGROUP") {
          const h = document.createElement("div");
          h.className = "csel-group";
          h.textContent = child.label;
          menu.appendChild(h);
          for (const opt of child.children) menu.appendChild(optButton(opt));
        } else if (child.tagName === "OPTION") {
          menu.appendChild(optButton(child));
        }
      }
    }
    function optButton(opt) {
      const o = document.createElement("button");
      o.type = "button";
      o.className = "csel-opt" + (opt.value === sel.value ? " on" : "");
      o.setAttribute("role", "option");
      o.disabled = opt.disabled;
      o.textContent = opt.textContent;
      o.addEventListener("click", () => {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        close();
        btn.focus();
      });
      return o;
    }
    function sync() {
      const opt = sel.options[sel.selectedIndex];
      label.textContent = opt ? opt.textContent : "";
      btn.disabled = sel.disabled;
      btn.classList.toggle("disabled", sel.disabled);
    }
    function open() {
      if (btn.disabled) return;
      buildMenu();
      menu.hidden = false;
      wrap.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKey, true);
    }
    function close() {
      menu.hidden = true;
      wrap.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKey, true);
    }
    function onDocClick(e) {
      if (!wrap.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === "Escape") { close(); btn.focus(); }
    }
    btn.addEventListener("click", () => (menu.hidden ? open() : close()));
    // Native select behavior for keyboard users who never open the menu:
    // arrow keys step the value directly, Enter/Space/Down opens it.
    btn.addEventListener("keydown", (e) => {
      if (menu.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        let i = sel.selectedIndex;
        do { i += dir; } while (i >= 0 && i < sel.options.length && sel.options[i].disabled);
        if (i >= 0 && i < sel.options.length) {
          sel.selectedIndex = i;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    // Options/value can change from page code (repopulating a Trial or
    // Hackatime-project list, resetting a form) - keep the button and any
    // open menu in sync without every call site remembering to refresh it.
    sel.addEventListener("change", () => {
      sync();
      if (!menu.hidden) buildMenu();
    });
    new MutationObserver(() => {
      sync();
      if (!menu.hidden) buildMenu();
    }).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });

    sync();
  }

  function enhanceSelects(root = document) {
    root.querySelectorAll("select").forEach(enhanceSelect);
  }
  enhanceSelects();
  // Forms are routinely rebuilt via innerHTML after an async fetch (project
  // editor, trial picker, etc.), long after this script's initial pass - a
  // one-shot scan at load would miss every select in them.
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "SELECT") enhanceSelect(node);
        else if (node.querySelectorAll) node.querySelectorAll("select").forEach(enhanceSelect);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Pages can opt out of the sign-in gate (e.g. the public docs) by setting
  // window.PIXL_PUBLIC = true before loading this script.
  if (!token && !window.PIXL_PUBLIC) {
    document.addEventListener("DOMContentLoaded", gate);
  }

  return { API, config, token, api, apiUrl, send, upload, esc, bbcode, bbstrip, markdown, toast, mountTopbar, loadWallet, loadRestoration, timeAgo, countdown, hours, hasToken: !!token, runTour, maybeOnboard, ONBOARDING_STEPS, confirm: confirmDialog, setTheme, loginUrl, enhanceSelects, reForHours, projectPayoutUsd, projectPayoutPx };
})();
