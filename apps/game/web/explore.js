/* Shared rendering for the explore family. Three pages use this: /explore
 * (browse every build), /players (the directory, plus one profile at
 * /players/<id>) and /leaderboard.
 *
 * It used to be one tabbed page switching on location.hash. The views are real
 * pages now, so the hash router is gone and each page calls the one view it
 * wants through window.Explore below. The code itself is shared rather than
 * copied three times.
 *
 * Loaded after /pixl.js, which it needs for Pixl.api/esc/hasToken/etc.
 */
const view = document.getElementById("view");
const cache = {};

function levelBadge(p) {
  return p.level != null ? `<span class="chip gold">LV ${p.level}</span>` : "";
}

function avatarHtml(p) {
  const letter = Pixl.esc(String(p.display_name || "?").trim().charAt(0).toUpperCase() || "?");
  const avatarUrl = p.avatar_url ? String(p.avatar_url) : "";
  const pixifySrc =
    p.id && p.card_pixelate !== false
      ? Pixl.apiUrl(`/api/pixify?user=${encodeURIComponent(p.id)}&size=48`)
      : "";
  const src = pixifySrc || avatarUrl;
  if (!src) return `<div class="avatar">${letter}</div>`;
  // Pixify pulls from Slack and can 404/503 (no Slack photo, service down);
  // fall back to the player's own uploaded pfp before giving up on a letter.
  const fallback = pixifySrc && avatarUrl ? Pixl.esc(avatarUrl) : "";
  const onerror = fallback
    ? `this.onerror=function(){this.parentNode.textContent='${letter}'};this.src='${fallback}'`
    : `this.parentNode.textContent='${letter}'`;
  return `<div class="avatar"><img src="${Pixl.esc(src)}" alt="" loading="lazy" onerror="${onerror}"></div>`;
}

// Same label vocabulary as statusInfo() in the player's own projects page: a
// project only reads SHIPPED once it's actually approved, not the moment it's
// merely submitted for review.
function statusChip(p) {
  const s = String(p.status || "draft");
  const LABELS = {
    approved: ["SHIPPED", "green"],
    shipped: ["IN REVIEW", "teal"],
    second_review: ["IN REVIEW", "teal"],
    needs_changes: ["NEEDS CHANGES", "red"],
  };
  const [label, tone] = LABELS[s] || [s.replace("_", " "), ""];
  return `<span class="chip status-chip ${tone}">${Pixl.esc(label)}</span>`;
}

// Reviewer-nominated standout project - cosmetic only, no payout effect.
function beaconChip(p) {
  return p.is_peak
    ? `<span class="chip gold" title="Nominated as a standout project by a reviewer">★ BEACON</span>`
    : "";
}

function projCard(p) {
  return `
    <a class="card panel proj-card" href="/project/${Number(p.id)}">
      <div class="proj-thumb">${p.image_url ? `<img src="${Pixl.esc(p.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</div>
      <div class="proj-name">${Pixl.esc(p.name)}${p.is_peak ? " ★" : ""}</div>
      <div class="proj-meta">
        <span>by ${Pixl.esc(p.owner_name || "?")}</span>
        <span>${Pixl.timeAgo(p.created_at)}</span>
      </div>
      <div class="proj-foot">
        <span>${statusChip(p)}${levelBadge(p)}${beaconChip(p)}${p.hackatime_seconds ? ` <span class="chip teal">${Pixl.hours(p.hackatime_seconds)}</span>` : ""}</span>
        ${Pixl.hasToken
          ? `<span class="vote-group">${upvoteBtn(p)}${downvoteBtn(p)}</span>`
          /* A guest reaching these through a shared profile can't vote, and a
             live button would only send them into the sign-in gate. */
          : `<span class="chip">▲ ${p.upvotes || 0}</span>`}
      </div>
    </a>`;
}

// The canonical, unfurlable link for a profile.
window.copyPlayerLink = async function (e, id) {
  e.preventDefault();
  e.stopPropagation();
  const link = location.origin + "/players/" + id;
  try {
    await navigator.clipboard.writeText(link);
    Pixl.toast("Link copied!");
  } catch {
    Pixl.toast(link);
  }
  return false;
};

// Upvote pill. Click again to remove your vote; disabled only while the
// opposite direction is active (remove that one first to switch).
function upvoteBtn(p) {
  return `<button class="upvote-btn${p.has_upvoted ? " on" : ""}" onclick="return castVote(event,${Number(p.id)},'up')"${p.has_downvoted ? " disabled" : ""} aria-label="Upvote this project" title="${p.has_upvoted ? "Remove your upvote" : "Upvote this project"}">▲ <span class="uv-count">${p.upvotes || 0}</span></button>`;
}

// Downvote pill. Same removable, click-to-toggle behaviour as upvote.
function downvoteBtn(p) {
  return `<button class="downvote-btn${p.has_downvoted ? " on" : ""}" onclick="return castVote(event,${Number(p.id)},'down')"${p.has_upvoted ? " disabled" : ""} aria-label="Downvote this project" title="${p.has_downvoted ? "Remove your downvote" : "Downvote this project"}">▼ <span class="dv-count">${p.downvotes || 0}</span></button>`;
}

// Cast or remove an up/downvote without following the card link (click an
// already-active vote to take it back). Updates both buttons in place; the
// server is idempotent, rejects self-votes, and blocks voting the opposite
// direction until you remove your current vote first.
window.castVote = async function (e, id, dir) {
  e.preventDefault();
  e.stopPropagation();
  const btn = e.currentTarget;
  if (btn.disabled) return false;
  const removing = btn.classList.contains("on");
  const group = btn.closest(".vote-group") || btn.parentElement;
  const upBtn = group ? group.querySelector(".upvote-btn") : null;
  const downBtn = group ? group.querySelector(".downvote-btn") : null;
  if (upBtn) upBtn.disabled = true;
  if (downBtn) downBtn.disabled = true;
  const path = "/api/projects/" + id + "/" + (dir === "up" ? "upvote" : "downvote");
  const r = await Pixl.send(removing ? "DELETE" : "POST", path);
  if (r.ok) {
    btn.classList.toggle("on", !removing);
    const c = btn.querySelector(dir === "up" ? ".uv-count" : ".dv-count");
    if (c) c.textContent = dir === "up" ? r.upvotes : r.downvotes;
    if (upBtn) upBtn.disabled = dir === "down" && !removing;
    if (downBtn) downBtn.disabled = dir === "up" && !removing;
  } else {
    if (upBtn) upBtn.disabled = false;
    if (downBtn) downBtn.disabled = false;
    const msg = r.error === "own_project" ? "You can't vote on your own project."
      : r.error === "already_upvoted" || r.error === "already_downvoted" ? "You've already voted on this project."
      : r.error === "not_found" ? "You can't upvote unshipped projects."
      : `Couldn't ${dir}vote right now.`;
    Pixl.toast(msg, true);
  }
  return false;
};

/* ---------- views ---------- */

async function showPlayers(q = "") {
  // Only build the searchbar/input once per visit to this tab - rebuilding it
  // on every debounced keystroke (the old behavior) destroyed and recreated
  // the <input>, which reset the cursor to the end and could scramble/drop
  // fast-typed characters. A re-call from the input's own listener below just
  // refreshes the results underneath, leaving the live input element alone.
  let input = document.getElementById("pq");
  if (!input) {
    view.innerHTML = `
      <div class="searchbar"><input class="field" id="pq" type="search" placeholder="Find a player…" value="${Pixl.esc(q)}" autocomplete="off"></div>
      <div id="playersResults"></div>`;
    input = document.getElementById("pq");
    let t;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => showPlayers(input.value.trim()), 350); });
    input.focus();
  }
  const results = document.getElementById("playersResults");
  results.innerHTML = `<div class="spin"></div>`;

  const data = await Pixl.api("/api/explore/players" + (q ? "?q=" + encodeURIComponent(q) : ""));
  if (input.value.trim() !== q) return;
  const players = data.players || [];
  results.innerHTML = players.length === 0
    ? `<div class="empty-note">NOBODY HERE BY THAT NAME.</div>`
    : `<div class="grid">${players.map((p) => `
        <a class="card panel pcard" href="/players/${Pixl.esc(p.id)}">
          ${avatarHtml(p)}
          <div class="pname">${Pixl.esc(p.display_name)}</div>
          <div class="pmeta">${p.project_count} project${p.project_count === 1 ? "" : "s"} · joined ${Pixl.timeAgo(p.created_at)}</div>
        </a>`).join("")}</div>`;
}

async function showProjects(opts = {}) {
  const q = opts.q || "";
  const tier = opts.tier || "all";
  const shipped = opts.shipped || "all";
  // Same fix as showPlayers above: only build the searchbar/inputs once per
  // visit to this tab, not on every debounced keystroke or filter change -
  // rebuilding the <input> mid-typing reset the cursor and could scramble
  // fast-typed characters. Listeners read the live input/select values
  // (not the q/tier/shipped closed over at attach-time) so they stay correct
  // across repeated re-calls that only refresh the results underneath.
  let input = document.getElementById("jq");
  let tierSel = document.getElementById("jtier");
  let shipSel = document.getElementById("jshipped");
  if (!input) {
    view.innerHTML = `
      <div class="searchbar">
        <input class="field" id="jq" type="search" placeholder="Find a project…" value="${Pixl.esc(q)}" autocomplete="off">
        <select class="field" id="jtier">
          <option value="all">ALL TIERS</option>
          <option value="1"${tier === "1" ? " selected" : ""}>TIER 1</option>
          <option value="2"${tier === "2" ? " selected" : ""}>TIER 2</option>
          <option value="3"${tier === "3" ? " selected" : ""}>TIER 3</option>
          <option value="4"${tier === "4" ? " selected" : ""}>TIER 4</option>
        </select>
        <select class="field" id="jshipped">
          <option value="all">ALL PROJECTS</option>
          <option value="shipped"${shipped === "shipped" ? " selected" : ""}>SHIPPED</option>
          <option value="unshipped"${shipped === "unshipped" ? " selected" : ""}>UNSHIPPED</option>
        </select>
      </div>
      <div id="projectsResults"></div>`;
    input = document.getElementById("jq");
    tierSel = document.getElementById("jtier");
    shipSel = document.getElementById("jshipped");
    tierSel.value = tier;
    shipSel.value = shipped;
    let t;
    input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => showProjects({ q: input.value.trim(), tier: tierSel.value, shipped: shipSel.value }), 350); });
    tierSel.addEventListener("change", () => showProjects({ q: input.value.trim(), tier: tierSel.value, shipped: shipSel.value }));
    shipSel.addEventListener("change", () => showProjects({ q: input.value.trim(), tier: tierSel.value, shipped: shipSel.value }));
  } else {
    tierSel.value = tier;
    shipSel.value = shipped;
  }
  const results = document.getElementById("projectsResults");
  results.innerHTML = `<div class="spin"></div>`;

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (tier !== "all") params.set("tier", tier);
  if (shipped !== "all") params.set("shipped", shipped);
  const qs = params.toString();
  const data = await Pixl.api("/api/explore/projects" + (qs ? "?" + qs : ""));
  if (input.value.trim() !== q) return;
  const projects = data.projects || [];
  results.innerHTML = projects.length === 0
    ? `<div class="empty-note">${q || tier !== "all" || shipped !== "all" ? "NO PROJECTS MATCH THOSE FILTERS." : "NO PROJECTS YET, GO MAKE THE FIRST ONE!"}</div>`
    : `<div class="grid">${projects.map(projCard).join("")}</div>`;
}

const LB_TABS = [
  { key: "pixels", label: "PIXELS" },
  { key: "referrals", label: "REFERRALS" },
  { key: "upvotes", label: "UPVOTES" },
];

function boardRow(p, unit, sub) {
  const suffix = sub === "referrals" ? `<span class="faint" style="font-size:11px;margin-left:6px">${p.pixels.toLocaleString()} PX earned</span>` : "";
  return `
    <div class="board-row ${p.rank <= 3 ? "top" + p.rank : ""} ${p.you ? "you" : ""}">
      <span class="rank">${p.rank <= 3 ? ["#1", "#2", "#3"][p.rank - 1] : "#" + p.rank}</span>
      <span class="bname">${Pixl.esc(p.display_name)}${p.you ? ' <span class="gold">← YOU</span>' : ""}</span>
      <span class="bpx${unit === "PX" ? " px" : ""}">${unit === "PX" ? `<img src="/img/pixel.png" alt="">` : ""}${p.value.toLocaleString()} ${unit}${suffix}</span>
    </div>`;
}

async function showLeaderboard(sub) {
  if (!LB_TABS.some((t) => t.key === sub)) sub = "pixels";
  view.innerHTML = `
    <div class="tabs lb-subtabs" id="lbTabs">${LB_TABS.map((t) => `<button class="tab${t.key === sub ? " active" : ""}" data-lb="${t.key}">${t.label}</button>`).join("")}</div>
    <div id="lbBody"><div class="spin"></div></div>`;
  document.querySelectorAll("#lbTabs [data-lb]").forEach((b) =>
    b.addEventListener("click", () => {
      location.href = b.dataset.lb === "pixels" ? "/leaderboard/" : "/leaderboard/" + b.dataset.lb;
    }));
  const body = document.getElementById("lbBody");

  if (sub === "pixels") {
    const data = await Pixl.api("/api/explore/leaderboard");
    const rows = (data.players || []).map((p) => boardRow({ ...p, value: p.pixels }, "PX")).join("");
    const sprint = data.sprint ? `
      <div class="sprint-panel panel-deep">
        <h3>${Pixl.esc(data.sprint.name)}</h3>
        <div class="faint" style="font-size:12px;margin-bottom:12px">Pixels earned during the event only · ${Pixl.countdown(data.sprint.ends_at)}</div>
        <div class="board">${(data.sprint.players || []).map((p) => `
          <div class="board-row ${p.you ? "you" : ""}">
            <span class="rank">#${p.rank}</span>
            <span class="bname">${Pixl.esc(p.display_name)}${p.you ? ' <span class="gold">← YOU</span>' : ""}</span>
            <span class="bpx px">${p.pixels.toLocaleString()} PX</span>
          </div>`).join("") || '<div class="faint">No sprint pixels yet, be first!</div>'}
        </div>
        <div class="muted" style="font-size:13px;margin-top:10px">Your sprint total: ${Number(data.sprint.your_pixels || 0).toLocaleString()} PX</div>
      </div>` : "";
    body.innerHTML = `
      <div class="board">${rows || '<div class="empty-note">NO PIXELS ANYWHERE YET.</div>'}</div>
      <div class="you-card panel">
        <span class="gold">YOUR STANDING</span>
        <span>${data.yourRank ? "#" + data.yourRank : "UNRANKED"}</span>
        <span class="gold">${Number(data.yourPixels > 0 ? data.yourPixels : 0).toLocaleString()} PX</span>
        <span class="faint" style="font-size:12px">ship projects to climb</span>
      </div>
      ${sprint}`;
    return;
  }

  const endpoint = sub === "referrals" ? "/api/explore/leaderboard/referrals" : "/api/explore/leaderboard/upvotes";
  const unit = sub === "referrals" ? "REFERRED" : "▲";
  const emptyMsg = sub === "referrals" ? "NOBODY'S REFERRED ANYONE YET." : "NO UPVOTES ANYWHERE YET.";
  const climbMsg = sub === "referrals" ? "refer friends to climb" : "ship great work to climb";
  const data = await Pixl.api(endpoint);
  const rows = (data.players || []).map((p) => boardRow(p, unit, sub)).join("");
  body.innerHTML = `
    <div class="board">${rows || `<div class="empty-note">${emptyMsg}</div>`}</div>
    <div class="you-card panel">
      <span class="gold">YOUR STANDING</span>
      <span>${data.yourRank ? "#" + data.yourRank : "UNRANKED"}</span>
      <span class="${unit === "PX" ? "gold" : "teal"}">${Number(data.yourValue > 0 ? data.yourValue : 0).toLocaleString()} ${unit}</span>
      <span class="faint" style="font-size:12px">${climbMsg}</span>
    </div>`;
}

// Total RE needed to reach a level - mirrors apps/server's reForLevel, off
// the same Pixl.config.economy.levelBands the game already ships to this page.
function reForLevel(level) {
  let re = 0, prevTop = 0;
  for (const band of Pixl.config.economy.levelBands) {
    const top = Math.min(level, band.throughLevel);
    if (top > prevTop) re += (top - prevTop) * band.rePerLevel;
    prevTop = band.throughLevel;
    if (level <= band.throughLevel) break;
  }
  return re;
}

function xpProgress(p) {
  const lvl = p.level ?? 0;
  const re = Number(p.re || 0);
  const floor = reForLevel(lvl);
  const ceil = reForLevel(lvl + 1);
  const pct = lvl >= 100 || ceil <= floor ? 100 : Math.max(0, Math.min(100, ((re - floor) / (ceil - floor)) * 100));
  return { pct, re };
}

// Cosmetic title only, derived from level - not a stored field.
function classForLevel(level) {
  const lvl = level ?? 1;
  if (lvl >= 100) return "PIXL LEGEND";
  if (lvl >= 75) return "ELITE BUILDER";
  if (lvl >= 50) return "MASTER BUILDER";
  if (lvl >= 30) return "SENIOR BUILDER";
  if (lvl >= 15) return "SKILLED BUILDER";
  if (lvl >= 5) return "BUILDER";
  return "ROOKIE BUILDER";
}

// Merges real ship + badge-unlock events into one feed, newest first.
function recentActivity(projects, collectibles) {
  const events = [];
  for (const pr of projects) {
    if (pr.shipped_at) events.push({ t: pr.shipped_at, dot: "good", html: `Shipped <b>${Pixl.esc(pr.name)}</b>` });
  }
  for (const c of collectibles) {
    if (c.unlocked_at) events.push({ t: c.unlocked_at, dot: "gold", html: `Earned <b>${Pixl.esc(c.name)}</b>` });
  }
  events.sort((a, b) => new Date(b.t) - new Date(a.t));
  return events.slice(0, 6);
}

function badgeCell(c) {
  return `<div class="badge-cell" title="${Pixl.esc(c.description || c.name || "")}">
    <div class="b-thumb">${c.image_url ? `<img src="${Pixl.esc(c.image_url)}" alt="" loading="lazy" onerror="this.remove()">` : "◆"}</div>
    <div class="b-name">${Pixl.esc(c.name || "")}</div>
  </div>`;
}

// Signed in, the full profile (every project, the collectibles shelf). Signed
// out, the narrower public view: approved ships only, no collectibles, so a
// link anyone can open can't leak what somebody is still working on.
async function fetchPlayer(id) {
  const path = "/api/explore/players/" + encodeURIComponent(id);
  if (Pixl.hasToken) return Pixl.api(path);
  const res = await fetch(Pixl.API + path + "/public");
  if (!res.ok) throw new Error("http_" + res.status);
  return res.json();
}

async function showPlayer(id) {
  view.innerHTML = `<div class="spin"></div>`;
  let data;
  try { data = await fetchPlayer(id); }
  catch { view.innerHTML = `<div class="empty-note">PLAYER NOT FOUND.</div>`; return; }
  const p = data.player;
  const projects = data.projects || [];
  const collectibles = data.collectibles || [];
  const xp = xpProgress(p);
  const activity = recentActivity(projects, collectibles);
  const joinedYear = p.created_at ? new Date(p.created_at).getFullYear() : "-";

  view.innerHTML = `
    ${Pixl.hasToken
      ? `<a class="btn dark back-btn" href="/players/">← ALL PLAYERS</a>`
      : "" /* the directory needs a session, so a guest has nowhere to go back to */}
    <button class="btn ghost back-btn" onclick="return copyPlayerLink(event,'${Pixl.esc(id)}')">COPY LINK</button>
    <div class="ticket-layout">
      <div class="ticket-frame">
        <div class="ticket-head"><span class="tname">${Pixl.esc(p.display_name)}</span></div>
        <div class="ticket-avatar">${avatarHtml(p)}</div>
        <div class="tstat-v ts-level"><span class="tlabel">LEVEL</span><span class="tval">${p.level ?? 1}</span></div>
        <div class="tstat-v ts-hours"><span class="tlabel">HOURS</span><span class="tval">${Number(p.xp_hours || 0).toFixed(0)}h</span></div>
        <div class="tstat-v ts-proj"><span class="tlabel">PROJECTS</span><span class="tval">${projects.length}</span></div>
        <div class="tstat-v ts-joined"><span class="tlabel">JOINED</span><span class="tval">${joinedYear}</span></div>
        <div class="ticket-xp-track"><div class="ticket-xp-fill" style="width:${Math.max(0, Math.min(100, xp.pct))}%"></div></div>
        <div class="ticket-currency">
          <div class="tc-row tc-re">× ${xp.re.toLocaleString()} RE</div>
          <div class="tc-row tc-px"><img src="../img/pixel_currency.png" alt="">${Math.round(Number(p.pixels || 0)).toLocaleString()}</div>
        </div>
        <div class="ticket-foot">
          <div class="tf-class">CLASS: ${classForLevel(p.level)}</div>
          <div class="tf-sub">PIXELIAN · MEMBER SINCE ${joinedYear}</div>
        </div>
        <img class="ticket-sticker sticker-red" src="../img/sticker_currency_red.png" alt="">
        <img class="ticket-sticker sticker-gold" src="../img/sticker_currency_gold.png" alt="">
      </div>

      <div class="dash-col">
        ${activity.length ? `
        <div class="dash-section">
          <div class="dash-h">RECENT ACTIVITY</div>
          <div class="activity-list">${activity.map((e) => `
            <div class="activity-row"><span class="adot" style="background:var(--${e.dot})"></span>
              <span class="abody">${e.html}</span><span class="atime">${Pixl.timeAgo(e.t)}</span></div>`).join("")}</div>
        </div>` : ""}

        ${collectibles.length ? `
        <div class="dash-section">
          <div class="dash-h">EQUIPPED BADGES &amp; INVENTORY</div>
          <div class="badge-grid">${collectibles.map(badgeCell).join("")}</div>
        </div>` : ""}

        <div class="dash-section">
          <div class="dash-h">PROJECTS (${projects.length})</div>
          ${projects.length === 0
            ? `<div class="empty-note">NO PROJECTS YET.</div>`
            : `<div class="ship-grid">${projects.map((pr) => projCard({ ...pr, owner_name: p.display_name })).join("")}</div>`}
        </div>
      </div>
    </div>`;
}

// A collectible the player owns, shown as a small badge on their profile.
function collChip(c) {
  return `<div class="coll panel" title="${Pixl.esc(c.description || "")}">
    <div class="coll-thumb">${c.image_url ? `<img src="${Pixl.esc(c.image_url)}" alt="" onerror="this.remove()">` : "▲"}</div>
    <div class="coll-name">${Pixl.esc(c.name)}</div>
  </div>`;
}

/* ---------- what each page calls ---------- */

// Every view here needs a session except one profile, so the pages that can't
// render anything signed out say so rather than sitting on an empty panel.
function requireSession() {
  if (Pixl.hasToken) return true;
  view.innerHTML = `<div class="empty-note">SIGN IN TO SEE THIS.</div>`;
  return false;
}

window.Explore = {
  players: () => requireSession() && showPlayers(),
  projects: () => requireSession() && showProjects(),
  leaderboard: (sub) => requireSession() && showLeaderboard(sub),
  // The one view that works signed out, since a profile link gets pasted
  // where people don't have accounts.
  player: (id) => showPlayer(id),
};
