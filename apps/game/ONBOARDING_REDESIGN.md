# Pixl Onboarding Redesign - From First Frame to First Ship

> Design + implementation spec. Every claim below is anchored to a file that was
> read; citations are `path:line`. Canon is from the story doc + the code's own
> lore (`guide_hud.gd`, `web/docs/index.html`, `vault_levels`).

---

## 0. What a new player actually sees today (traced, screen by screen)

1. **`scenes/login.tscn`** (`login.gd`). "Login" → `NetworkManager.start_login()` opens
   the browser for Hack Club Auth. On `connected_to_server` → `change_scene_to_file("res://scenes/main_menu.tscn")` (`login.gd:28-29`).
2. **`scenes/main_menu.tscn`** (`main_menu.gd`). New accounts are flagged by `?new=1`
   on the auth callback (`auth.ts:221,276` → `network_manager.gd:161,189`). If
   `is_new_account`, `_ready()` pops a **"PICK A NAME" modal** - *"Welcome to Pixl!
   What should other villagers call you?"*, a `LineEdit` (max 24) with a **"Keep
   current"** escape hatch (`main_menu.gd:64-65, 103-204`). POSTs `/api/profile/name`.
3. Player clicks **Play** → `Loader.change_scene("res://scenes/village.tscn", "Entering village")` (`main_menu.gd:67-68`). Loading overlay covers a server round-trip (`loader.gd`).
4. **`scenes/village.tscn`** (`village.gd` → `multiplayer_world.gd`). `_ready()` spawns
   NPCs, waits 0.3s, then `GuideHud.maybe_show_intro()` (`village.gd:14-22`).
5. **The guide** (`guide_hud.gd`). For a signed-in new player (server
   `onboarding_step == 0`) it auto-opens a **9-page slideshow** over the live village:
   `WELCOME · THE STORY · WHY YOU'RE HERE · GETTING AROUND · HANG OUT · PROJECTS &
   PIXELS · SHOP & SIDEQUESTS · EXPLORE · HANDY KEYS` (`guide_hud.gd:266, 283-345`).
   Last page → **"Open my Dashboard →"** → `_go_to_dashboard()` = `_post_step(1)` +
   `WebPages.open("projects")` (`guide_hud.gd:119-122, 253`).
6. **Web shell** `apps/game/web/projects/` opens in a **new browser tab**
   (`?token=…&embed=1`, `web_pages.gd:33-54`). `pixl.js` auto-runs a **second,
   separate 8-step walkthrough** (`ONBOARDING_STEPS`, `pixl.js:396-436`) that
   re-tells the same lore and loop, then syncs `onboarding_step → 2` (`pixl.js:481-497`).

**Character customization is not in this flow at all.** The editor
(`character_editor.tscn`) is only reachable from a main-menu button or the pause
menu (`main_menu.gd:82-84`, `pause_menu.gd:499`). New Builders spawn as the default
skin `cvc:1` (`player.gd:9`).

**"Dashboard" is a misnomer.** `apps/dashboard` is admin/review/moderation only
(`Shell.tsx` nav flags `review`/`moderation`/`reviewers`). The onboarding "dashboard"
is actually the **player web shell** at `apps/game/web/`, the real player surface.

---

## 1. Critique - what breaks the arrival → ship loop

The loop we must reinforce: **Arrival → learn why Pixl exists → create Builder
identity → pick a Trial → build → ship → repair the world → rewards → keep exploring.**

1. **There is no arrival.** No cinematic, no landing beat. Login → menu → *pop
   straight into a fully-populated village* under a modal. The single most emotional
   canon beat - Day 0, the spacecraft, witnessing a frozen world - exists **nowhere**.
   It's delivered as slideshow pages 2–3 of text (`guide_hud.gd:290-299`), not *lived*.
2. **Identity is an out-of-order admin form.** "What should everyone call you?"
   fires as a modal on the **main menu** (`main_menu.gd:_show_name_prompt`), before the
   player has seen the world or met a soul, it reads as account settings, and it's
   skippable ("Keep current"). Nothing about it feels *earned*.
3. **Pixo does not exist.** The brief's guide character has no NPC and no companion.
   Onboarding is a disembodied slideshow. Village NPCs are `Pip, Mangoman, Imu, Gabin,
   Ricky` (`village.tscn:2807-2834`), no Pixo.
4. **The story is a wall of text you're told to skip.** `guide_hud.gd:298` literally
   says *"You don't need to memorise the lore."* The slideshow front-loads a
   **keyboard-shortcut manual** (`GETTING AROUND`, `HANG OUT`, `HANDY KEYS`) - a
   reference card, not an onboarding - before the player has any reason to care.
5. **Zero personalization.** No experience question, no field for it, no downstream
   effect. Every Builder gets the identical generic path.
6. **No Trial recommendation, and the schema can't support one.** `sidequests`
   (`0031_sidequests.sql`) has **no difficulty, no tags, no category, no starter/
   recommended flag**, and NPC-unlock wiring "lands later" (`sidequests.ts:7-8`,
   comment). The canon Starter Trials (profile page, hello-world bot, progress
   tracker) live in **no data anywhere**. The slideshow just says "press J to see
   every sidequest."
7. **The hand-off ejects you into a browser tab and a redundant second onboarding.**
   The slideshow ends by throwing you to a new tab (`WebPages.open("projects")`) where
   `pixl.js` runs an **entirely separate 8-step tour** re-explaining the same lore
   ("Long ago a world called Origin shattered…", `pixl.js:404`). Two disconnected
   walkthroughs stitched by one INT counter; the player loses the village the instant
   they're told to "build."
8. **The first-project moment has no intent trigger.** The projects NPC (Pip,
   `village.tscn:2810` `opens_projects=true`) just calls `WebPages.open("projects")` on
   E with no framing. The `quest_project` NPC path (`npc.gd:220-248`) is wired to **no
   village NPC**. "Open your first Trial" is literally just "a browser tab opened."

---

## 2. Redesigned structure - beat by beat

Each beat names the loop stage it serves. Nothing here that doesn't serve one.

| # | Beat | Scene / surface | Loop stage |
|---|------|-----------------|------------|
| 0 | Login | `login.tscn` (unchanged) | - |
| 1 | **Assemble your Builder** (char editor, first-run, required) | `character_editor.tscn` (new first-run mode) | *Arrival prep* |
| 2 | **The Cinematic** (5 illustrated panels) | `intro_cinematic.tscn` (**new**) | *Arrival* |
| 3 | **Arrival at the Hub** - camera pan, Pixo greets | `village.tscn` (arrival mode) | *Arrival → why Pixl exists* |
| 4 | **The Naming Ritual** - Pixo asks your name | in-world overlay | *Builder identity* |
| 5 | **The Experience Question** - Pixo asks your level | dialogue choice | *personalize identity* |
| 6 | **Why Builders matter** - Pixo explains the loop, pointing at the Core | dialogue | *learn why Pixl exists* |
| 7 | **Your first Trial** - the Trial Board recommends one | `trial_board_hud` (**new**) | *pick a Trial* |
| 8 | **Open the Builder Terminal** - carry the Trial to the web shell | `web/projects` (`?trial&from=game`) | *build → ship → rewards* |
| 9 | Build (real work) → Ship → review | `web/projects` → dashboard (admin) | *ship / review* |
| 10| **First Thaw** - return to a visibly changed Hub, Pixo acknowledges | `village.tscn` | *repair world / rewards / keep exploring* |

**Why this order fixes the loop:** identity + experience now happen *inside the
world, staged by a character*, after the player has a reason to care (they just
watched their world die and get renamed after them). The Trial recommendation is the
*bridge* into the terminal, so "go build" carries a concrete first job instead of
dumping the player into an empty projects page + a redundant tour.

---

## 3. The Cinematic (Beat 2)

### Feasibility decision (Godot 4 web export)

- **Pre-rendered video** - Godot web `VideoStreamPlayer` needs Theora `.ogv`; web
  playback is finicky and inflates the `web/` bundle (the build already ships at
  `pixl.rsvp/play`). **Rejected as the default.**
- **In-engine 3D/tilemap recreation of "Origin at its peak"** - needs grand-city art
  that doesn't exist; the game only has cozy-town/farwest/voxel tilesets + NPC sheets
  (`assets/`). **Rejected.**
- **✅ Sequence of full-screen illustrated panels** - a `CanvasLayer` of `TextureRect`
  stills, tween cross-fades, a typewriter caption, and cheap `CPUParticles2D` for the
  "static". No new engine feature, no codec risk, ~5 stills of art. Reuses tween
  idioms already in `guide_hud.gd:279-281`. **Chosen.** Reserve a hidden
  `VideoStreamPlayer` behind the panels so a real cut can drop in later (matches the
  lore doc's "if we have money → real art epic cinematic").

### Panels (visual · tone · duration · caption)

Skippable throughout (`Skip ▸` bottom-right; ESC skips to arrival). First-run
auto-plays; replayable from Settings/Handbook. Captions type on, one clause per beat.

**1 - ORIGIN AT ITS PEAK.** A vast city of light, floating structures, the Core
glowing at center. Warm gold, awe. ~6s.
> "Once, there was Origin, the brightest world the machine ever dreamed."
> "Every idea ever built flowed into one place: the Core."

**2 - OVERLOAD.** Push in on the Core, light swelling, hairline white cracks. Rising
hum, unease. ~5s.
> "For centuries it held every invention. Every blueprint. Every spark."
> "Until it held too much."

**3 - THE GREAT STATIC.** White-out shatter; the city breaks into pixels and static
(`CPUParticles2D` burst), then dead silence. Violent, brief. ~4s.
> "Then came the Great Static."
> "In one surge, Origin shattered into a thousand islands, adrift in the Void."

**4 - THE LAST SPACECRAFT.** A lone pixel ship leaves the ruins, crosses a starfield
toward a small blue planet. Fragile hope. ~6s.
> "The survivors couldn't rebuild alone. So they crossed the Void looking for help -"
> "- and found a small blue planet full of people who build things for fun."
> "They found you."

**5 - ARRIVAL.** The ship descends toward a small, dim, pixelated hamlet on a floating
island. Quiet. ~5s → fade to gameplay.
> "They call this place Pixl now."
> "What's left of it is waiting."

Fade → `village.tscn` (arrival mode).

---

## 4. Arrival + Pixo (Beats 3–7) - complete dialogue

**Pixo's character** (canon: warm, a little worn by the Static, driven, *not* a
quipster). Small lore refinement (flagged, canon is silent): Pixo is a **patched-
together maintenance construct** the survivors built, which is *why* he "kept the Hub
lit" and reads warm-but-tired. Rendered as an `npc.tscn` instance, `npc_name="Pixo"`,
a bespoke skin sheet, standing at the arrival spawn.

### Camera (Beat 3)

Add a temporary `ArrivalCam: Camera2D` to the arrival scene, `make_current()`,
starting on the dead **Core spire** prop. Tween `position` toward the player spawn and
`zoom` `Vector2(3,3) → Vector2(4,4)` over 3.0s (`Tween.TRANS_SINE`), then hand back to
`player/$Camera2d.make_current()`. This reuses the existing `4.0 * zoom_level`
convention (`player.gd:55`). No new engine feature, just `Camera2D.make_current()` +
`Tween`. Movement locked via the existing `global.push_ui_blocker()` (`global.gd:17`)
until Pixo's greeting ends.

### Greeting (Pixo, `Dialogue.open("Pixo", [...])`)

> "Oh, you actually came. Good. I wasn't sure anyone would."
> "I'm Pixo. I've kept this little Hub lit since the Static hit. It's the last stable ground we've got."
> "Everything past the edge is frozen. Saloons stopped mid-song. Trains halted on the rails. Whole districts gone to pixels."
> "We can bring it back, that's not a hope, it's how this place works. But I can't do it alone, and neither can the Core."
> "First things first, though. Let's get you sorted."

### Beat 4 - Naming Ritual

> "So, what should everyone call you around here? Names matter. It's the first thing the world remembers about you."

→ themed input overlay (reuse the existing name-prompt UI from `main_menu.gd:103-204`,
but triggered here by Pixo). POSTs `/api/profile/name` (`profile.ts:21-46`).

- **Success** → Pixo: *"{name}. Alright, the Hub knows you now."*
- **Validation failure** (from `nameProblem()`, `profile.ts:10-19`): the server returns
  one of *too short / too long / bad charset / blocked word*. Pixo softens it:
  - blocked word → *"Hah, let's keep it friendly, yeah? The little ones look up to us. Try another."*
  - format/length → pass the server's reason through under Pixo's frame.
- **Honesty flag:** display names are **not unique** in the schema (`profile.ts` does no
  uniqueness check). Do **not** stage a "name taken" beat or promise exclusivity, the
  ritual is about *identity*, not ownership.

### Beat 5 - Experience Question

> "One more thing, so I know how much to explain. Be honest, there's no wrong answer, and you can't pick a wrong one."
> "How much have you built before?"

Choices (in-world, framed, routed through the extended `Dialogue` choice mode, §7):
- **"I'm just starting out."** → `beginner`
- **"I've shipped a few things."** → `intermediate`
- **"I build all the time."** → `advanced`

Responses:
- beginner → *"Perfect. Everyone starts somewhere, I'll walk you through the first one, step by step."*
- intermediate → *"Nice. I'll point you at something with a bit of bite and stay out of your way."*
- advanced → *"Good. Then I'll skip the hand-holding, the Core could use someone like you."*

Writes `users.coding_experience` (migration `0050`). See §8 for exact downstream effects.

### Beat 6 - Why Builders matter (the loop)

Short, pointing at the world. Keeps the **two currencies distinct** (per
`pixl.css:11-16`: `--gold` = Pixels you spend, `--teal` = Restoration Energy the
community pours into the Core; `xp.ts` confirms separate ledgers).

> "Here's the whole deal. See that dark spire? That's the Core, it used to power all of Origin. Now it's a sealed vault, holding everything we ever made."
> "You bring it back by building. Real things, a website, a bot, a game, whatever's yours. The jobs are called Trials."
> "Every hour of real work you ship becomes Restoration Energy. That's what thaws the world and wakes the Core."
> "And when the Core wakes, it hands back what it's been keeping, real gear, real rewards. That part isn't a metaphor."
> "Ship enough and you'll feel it: the more you build, the more each hour pays. Pixels for you, energy for all of us."

### Beat 7 - Your first Trial (recommend, don't force)

> "Come here, the Trial Board. This is where the Core posts what needs doing."
> "Based on what you just told me, I'd start with this one. It's not an order, the best Builders go off-map all the time. But it's a good first thaw."

→ **Trial Board HUD** (§6) surfaces the one recommended starter, highlighted, plus the
full starter list + a link to the Quest Log (J).

### Beat 8 - Open the Builder Terminal

On **Accept**:
> "That's the one. Opening your Builder Terminal, that's where you log the work, link your repo, and ship when it's ready."
> "Go build it for real. Come back when it's shipped, and watch what happens to this place."

→ `WebPages.open("projects?trial=<id>&from=game")` (extend `web_pages.gd`, §11).

### Beat 10 - First Thaw (return after first approval)

On the player's return once their first project is **approved** (`projects` status
`approved` → pixels credited, `xp.ts` / `projects.ts`), a scripted world change plays in
the Hub (a frozen prop unfreezes / a light comes on) and Pixo:
> "You feel that? That was you. The first light this place has seen in centuries."
> "There's a whole world past the edge just like it. Keep building, I'll keep the lamps on."

---

## 5. Documentation - "The Handbook" (Beat: surfaced at point of need)

Docs already exist as a **single static shell**, `apps/game/web/docs/index.html`:
section-anchored (`#welcome, #restoration, #sidequest, #building, #shipping, #rewards,
#html, #slack, #roblox, #hackatime, …`), left nav + scroll-spy, opened via
`WebPages.open("docs")`. So the "Builder Handbook" **is this shell**, no new CMS.

**Name it in-world: "The Handbook."** Presentation: a physical book prop near Pixo in
the Hub, *and* - critically - surfaced **contextually deep-linked**, never as a "read
later" nav item. `web_pages._build_url()` already splits on `#` and preserves the
fragment (`web_pages.gd:41-47`), so Pixo/the Terminal can open it *to the exact page*:
- beginner opening a **web** Trial → `WebPages.open("docs#html")` + `docs#hackatime`.
- a **bot** Trial → `docs#slack`.
- at Ship time → `docs#shipping` / `docs#submitting`.

The Handbook opens to the anchor the player needs, at the moment they need it.

---

## 6. First-Trial recommendation system

### Data model (exact columns, see `drizzle/0050_trial_recommendation.sql`)

`sidequests` today = `{ id, name, region, npc, description, reward, active, position,
created_by, created_at }` (`0031_sidequests.sql`). **No difficulty/tags/starter.**
Migration `0050` adds:

```sql
ALTER TABLE sidequests
  ADD COLUMN IF NOT EXISTS difficulty smallint NOT NULL DEFAULT 2,  -- 1 beg / 2 int / 3 adv
  ADD COLUMN IF NOT EXISTS tags       text[]   NOT NULL DEFAULT '{}', -- web/bot/game/ai/hardware/data
  ADD COLUMN IF NOT EXISTS starter    boolean  NOT NULL DEFAULT false;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS coding_experience text;  -- null=unasked | beginner|intermediate|advanced
```

`tags` deliberately mirrors `projects.project_type` values (`0044_project_type.sql`:
web/bot/game/…/other) so a shipped project can later be matched to a Trial. `0050`
also **seeds the three canon Chapter-I starters** (Raise your Builder Page / First
Contact / The Progress Beacon) at difficulty 1/2/3.

**Migration note:** this repo has no live `schema.ts`, Drizzle output lives as raw SQL
in `apps/server/drizzle/*.sql`, applied by hand in the Supabase SQL editor (see the
header of every existing file, e.g. `0046_onboarding_step.sql`). So there is **no
`db:generate` to run**; just apply `0050_trial_recommendation.sql`. (`db:migrate`
exists in `package.json` but the recent migrations are all "run this in Supabase".)

### Selection logic (server, new route)

`GET /api/sidequests/recommended?token=…` (add to `sidequests.ts`):

```ts
// 1. starters = active sidequests where starter = true
// 2. want = { beginner:1, intermediate:2, advanced:3 }[user.coding_experience] ?? 1
// 3. pick = starter whose difficulty === want; else nearest |difficulty - want|
//    tie-break by position, then id
// 4. return { recommended: pick, alternatives: starters }
```

"Recommend, don't force": the response always includes every starter, and the UI
always offers "browse all."

### Recommendation UI (in-game Trial Board, `trial_board_hud.gd`)

A `Control`/`CanvasLayer` overlay themed like `guide_hud` (its `TitlePlate` +
notch-panel + gold accents, `guide_hud.gd:172-203`):
- One large **highlighted card** = recommended Trial: name, region, **difficulty pips**,
  reward chip, **"Accept & open Terminal →"**.
- A scroll row of the other starters (tap to swap the highlight).
- Footer: **"Browse all Trials"** → Quest Log (`WebPages.open("quests")`, the existing
  `web/quests/` page, whose card markup already has `.quest.unlocked` styling,
  `quests/index.html:30-31`).

Copy is Pixo's (Beat 7). Accept → Beat 8.

---

## 7. Interaction-flow spec, input handling, state machine

### Screen state machine

```
login ─► [is_new_account? char_editor(first-run)] ─► intro_cinematic
      ─► village(ARRIVAL):
             cam_pan → pixo_greet → NAME_overlay → EXPERIENCE_choice
             → loop_patter → trial_board
      ─► [accept] web/projects?trial&from=game:
             FIRST_PROJECT_STEPS (mechanics only)
      ─► build ─► ship ─► [dashboard review, admin, offscreen]
      ─► village(RETURN): first_thaw + pixo_ack
```

### Input handling

- **Cinematic:** all gameplay input suppressed; only advance / `Skip`.
- **Arrival dialogue:** `global.push_ui_blocker()` locks movement (`global.gd:17`,
  already honored by `player.gd:90` and `npc.gd:206`). `Dialogue` `[E]` advances; choice
  overlays capture input.
- **After hand-off:** normal input resumes (`pop_ui_blocker()`).

### Skip / replay policy

- Cinematic: fully skippable (ESC / button), replayable from Settings + Handbook.
- Name + Experience: **cannot be dodged** (they write real data), but Experience has no
  "wrong" option and the whole exchange is short.
- Pixo's loop patter: fast-forwardable (`[E]` mash) but not removable.
- Everything is **replayable**, Pixo re-explains on repeat talk; F1 manual stays.

### Onboarding progress (architecture)

Today onboarding is one coarse INT `users.onboarding_step` 0/1/2, forward-only, shared
across game + web (`0046`, `profile.ts:159-204`, `pixl.js:467-476`). Keep it exactly as
the **cross-app hand-off** signal (it already works). For the finer arrival sub-beats,
add a client-side **`scripts/onboarding.gd` autoload** state machine (CINEMATIC →
ARRIVAL → NAME → EXPERIENCE → LOOP → TRIAL → HANDOFF) that:
- persists only the coarse milestone server-side (`onboarding_step 0 → 1` at hand-off),
- persists `coding_experience` once (§8),
- optionally persists mid-arrival resume via a **new nullable `users.onboarding_stage
  text`**, *flag: only add this if resume-after-quit-mid-arrival is wanted; otherwise
  the sub-beats are session-local and the coarse counter is enough.*

---

## 8. Coding-experience → exact downstream effects

Stored in `users.coding_experience`. Read by (a) the recommended-Trial route (§6) and
(b) `pixl.js` via a small `/api/profile/me` (or fold onto `/api/profile/wallet`,
`profile.ts:51`). No hand-waving, every effect is concrete:

| Answer | Recommended starter (difficulty) | First-project walkthrough (`pixl.js`) | Handbook deep-link | Pixo hint density |
|---|---|---|---|---|
| **beginner** | *Raise your Builder Page* (1, `web`) | **full** `FIRST_PROJECT_STEPS`: new → repo → demo → type → Hackatime → journal → Ship | `docs#html` + `docs#hackatime` | high (extra `[E]` tips) |
| **intermediate** | *First Contact* (2, `bot`) | **condensed**: repo/demo → Hackatime → Ship | `docs#slack` / `docs#building` | medium |
| **advanced** | *The Progress Beacon* (3, `web`/`data`) | **single card**: "you know the drill - repo, demo, Hackatime, Ship" | `docs#submitting` | low (Pixo steps back) |

---

## 9. Dashboard / web-shell transition (Beat 3h) - verdict

**Finding:** `apps/dashboard` is admin-only (`Shell.tsx` nav flags
`review`/`moderation`/`reviewers`; CLAUDE.md). It is **not** player-facing and the
current onboarding never actually goes there, `_go_to_dashboard()` opens the **player
web shell** `apps/game/web/projects` (`guide_hud.gd:122`).

**Verdict: redesign the hand-off, keep the surface, keep the admin dashboard out of the
player journey.**
- The player surface stays the `apps/game/web` shell, but reframed as the **Builder
  Terminal**, entered **carrying context** (`?trial&from=game`), not "open my dashboard."
- **Demote the redundant `pixl.js` lore tour** to a *fallback* for players who reach the
  shell **without** the in-game arrival (e.g. someone opening `pixl.rsvp/projects`
  directly). For the normal path (`from=game`), run the **contextual first-project
  walkthrough** instead, the player just *lived* the lore; don't re-tell it.
- Split `ONBOARDING_STEPS` (`pixl.js:396`) into `LORE_STEPS` (fallback) +
  `FIRST_PROJECT_STEPS` (mechanics only). Choose by `from=game` / `onboarding_step`.

---

## 10. First-project walkthrough - exact triggers

Replaces the generic 8-step tour. Each explanation fires **at the moment**, not "early
on". Reuses the existing `pixl.js` spotlight machinery (`runTour`, `pt-hole`,
`pixl.js:438-511`); anchors already exist in the projects page (`#new-btn`, `#s-ship`,
`#pixl-wallet`, `.nav`, referenced by the current tour).

1. **Terminal opens with a carried Trial** → a compact banner *"Trial: {name}. Here's how
   to ship it."* (no lore, they know it).
2. **Player clicks New / the Trial pre-fills a draft** → explain **repo + demo + type**
   (spotlight `#new-btn`). Type maps to `projects.project_type` (`0044`).
3. **A draft exists** → explain **Hackatime linking + journaling**: *"the review checks
   your repo, demo and journal, log as you go."* Grounded in the ship gate: `≥1h`
   tracked Hackatime, GitHub repo, reachable demo, image all required
   (`projects.ts:250-287`).
4. **Player hits Ship** (`#s-ship`) → explain **review → pixels + prize**. Grounded:
   ship sets status `shipped` (`projects.ts:323-334`) → dashboard review → `approved` →
   `pixel_transactions` + `approved_hours` credited (`xp.ts`, `profile.ts:71-108`).

---

## 11. Implementation map (concrete files)

**Add**
- `apps/game/scenes/intro_cinematic.tscn` + `apps/game/scripts/intro_cinematic.gd` - panel
  cinematic; hidden `VideoStreamPlayer` reserved for a future pre-rendered cut.
- `apps/game/assets/cinematic/panel1..5.png` (+ optional SFX). **Art dependency -
  flag:** ship first with placeholder solid-color panels + captions so the flow is
  testable before art exists.
- `apps/game/scripts/onboarding.gd` (**autoload**) - arrival state machine (§7); drives
  Pixo, ArrivalCam, name/experience overlays, server calls.
- **Pixo** - an `npc.tscn` instance in `village.tscn` at the arrival spawn
  (`npc_name="Pixo"`, bespoke skin), + a **Trial Board** prop (StaticBody2D + InteractArea
  or a small `scripts/trial_board.gd`).
- `apps/game/scripts/trial_board_hud.gd` - recommendation overlay (§6), themed off
  `guide_hud`.
- `apps/server/drizzle/0050_trial_recommendation.sql` - **already scaffolded** (this PR):
  sidequests `difficulty/tags/starter` + 3 seeded starters + `users.coding_experience`.

**Extend**
- `apps/game/scripts/dialogue.gd` - **the one genuinely-needed engine extension:** add
  (a) typewriter reveal, (b) an optional speaker-portrait slot, (c) a **choice mode**
  returning the picked index. Today it's plain one-line-at-a-time with no typewriter,
  portrait, or choices (`dialogue.gd:67-94`). The Experience question and any branch run
  through this instead of bespoke overlays.
- `apps/game/scripts/guide_hud.gd` - keep F1 as the **reference manual** (the shortcut
  pages are fine), but **remove its first-run role**: `maybe_show_intro()` triggers the new
  arrival, not the slideshow. Story pages move to the cinematic + Pixo.
- `apps/game/scripts/character_editor.gd` - add a **first-run mode** (DoneButton "Board the
  spacecraft →"), forced for `is_new_account` before the world.
- `apps/game/scripts/main_menu.gd` - **remove the name prompt** (moves to Pixo, Beat 4);
  route new accounts into char-editor → cinematic instead of Play → village.
- `apps/game/scripts/web_pages.gd` - allow extra query params (trial id, `from=game`) in
  `_build_url` (`web_pages.gd:40-54`).
- `apps/server/src/routes/sidequests.ts` - add `GET /api/sidequests/recommended` (§6).
- `apps/server/src/routes/profile.ts` - persist/read `coding_experience` (own route or on
  the onboarding POST, `profile.ts:177`); expose it on a small `/api/profile/me`.
- `apps/game/web/pixl.js` - split `ONBOARDING_STEPS` → `LORE_STEPS` +
  `FIRST_PROJECT_STEPS`; read `?trial`/`?from=game`; deep-link the Handbook (§5, §9, §10).

**Schema summary** (all in `0050`, plus one optional):
- `users.coding_experience text` (nullable).
- `sidequests.difficulty smallint`, `.tags text[]`, `.starter boolean`.
- *optional* `users.onboarding_stage text` - only for mid-arrival resume.
- **Keep** `users.onboarding_step` 0/1/2 unchanged.

---

## 12. Lore refinements (only where canon is silent / self-contradictory)

1. **Pixo's form** (canon silent): a survivor-built **maintenance construct** - grounds
   "kept the Hub lit" + the warm-but-worn tone without contradicting "guide character."
2. **Disaster name** (canon contradicts itself, "The Crash (name TBD)" vs "The Great
   Static"; `vault_levels` blurbs say "before the Crash", `0038`; the guide commits to
   "Great Static", `guide_hud.gd:292`). **Standardize:** *the Great Static* is the event;
   *the Crash* is the colloquial shorthand survivors use. Reconciles both, invents nothing.
3. **Names aren't unique** (code fact, `profile.ts`): keep the naming *ritual* about
   identity, never exclusivity, don't promise a unique name the schema doesn't enforce.
