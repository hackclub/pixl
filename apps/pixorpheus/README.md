# Pixorpheus

The official Slack bot of the [Pixl](https://hackclub.slack.com/archives/C0B5P4N0WHH) YSWS program, built by Gabin. Part entertainer, part support system, part AI with too much personality.

Pixorpheus handles the full help/ticket workflow for Pixl, talks to people in threads, remembers things about everyone, roasts people on demand, and generally acts like a teenager.

---

## Table of Contents

- [Architecture](#architecture)
- [Slash Commands](#slash-commands)
  - [Fun & Utility](#fun--utility)
  - [Pixl Program](#pixl-program)
  - [Memory & Knowledge](#memory--knowledge)
  - [Support Team Only](#support-team-only)
- [Inline Commands (pixo:)](#inline-commands-pixo)
- [Thread Controls](#thread-controls)
- [AI System](#ai-system)
- [Smart FAQ](#smart-faq)
- [Auto-Close](#auto-close)
- [Help & Ticket System](#help--ticket-system)
- [Style Listening System](#style-listening-system)
- [Training Mode](#training-mode)
- [Dashboard](#dashboard)
- [Database](#database)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)

---

## Architecture

Pixorpheus is a TypeScript Bun project (no build step - `bun run src/index.ts`), split by feature under `src/`:

| Path | Role |
|---|---|
| `src/index.ts` | Bootstrap - starts the Bolt app, loads memory/polls, wires up the auto-close cron |
| `src/slack/` | Shared Bolt `App`/`ExpressReceiver` instances, bot identity, `#pixl-logs` logging |
| `src/tickets/` | Full help/ticket workflow - repo, blocks, service, event/action/view handlers |
| `src/chat/` | Message handling - thread state, the main AI chat handler, welcome messages, polls, `:pixl-delete:` |
| `src/ai/` | OpenRouter client (buffered + streaming), the Pixorpheus persona/system prompt, emoji handling, web search, and docs answering (`docs.ts` fetch+cache, `answerFromDocs.ts` answer + `pixo_qa_cache`) |
| `src/memory/` | Per-user facts/personality, server-wide facts, speaking-style notes |
| `src/commands/` | Remaining slash commands (fun/utility, social, helpers, memory, ai, ship) |
| `src/pixelate/` | `/pixl` avatar pixelation command |
| `src/github/` | GitHub webhook -> Slack notifications |
| `src/external/` | API used by `apps/dashboard` to resolve tickets through this bot |
| `models.json` | OpenRouter model list |

There is no separate dashboard process anymore - the standalone helper dashboard (`dashboard.js`) was removed; ticket moderation now lives in `apps/dashboard` (the Next.js admin dashboard), which calls back into this bot via `src/external/ticketApi.ts`. The bot runs on Slack's Bolt v4 framework.

---

## Slash Commands

### Fun & Utility

| Command | Description |
|---|---|
| `/pixl-ping` | Check bot latency |
| `/pixl-help` | List all available commands |
| `/pixl-joke` | Get a random joke (via JokeAPI) |
| `/pixl-coinflip` | Flip a coin |
| `/pixl-fact` | Get a random surprising fact (AI-generated) |
| `/pixl-urban [word]` | Urban Dictionary definition - AI-filtered to remove the worst ones |
| `/pixl-ask [question]` | Ask Pixorpheus anything publicly |
| `/pixl-roast [@user]` | Roast someone (or yourself) - pulls from memory for extra precision |
| `/pixl-remind [time] [message]` | Set a reminder - supports `s`, `min`, `h` (e.g. `/pixl-remind 10min grab lunch`) - max 24h |
| `/pixl-countdown [time] [label]` | Countdown timer that posts to channel when it hits zero |
| `/pixl-poll Question; Option1, Option2 [, 10min]` | Create a poll with emoji reactions - add a time at the end to auto-close it |
| `/pixl-ship [description]` | Announce a project you shipped |
| `/pixl-stats` | Bot activity stats (pixelizations, AI replies, roasts, reminders - since last restart) |

### Pixl Program

| Command | Description |
|---|---|
| `/pixl [@user] [size]` | Pixelate a Slack profile picture - only works in the Pixl channels. Optional pixel size 2–64 (default 8). Reacts with `:pixl-delete:` to remove. |
| `/pixl-lastship [github_username]` | Show the last approved Hack Club Ship for a GitHub user (defaults to yours if known) |
| `/pixl-leaderboard` | Show who Pixorpheus knows the most facts about - the most engaged members |

### Memory & Knowledge

| Command | Description |
|---|---|
| `/pixl-mymemory [@user]` | See what Pixorpheus remembers about you (ephemeral) - or mention someone to show their profile publicly |
| `/pixl-helpstats` | Ticket stats - total, open, resolved counts |

### Support Team Only

These commands require being a helper, an admin (`SLACK_ADMIN_USER_IDS`), or a member of the ticket channel.

| Command | Description |
|---|---|
| `/pixl-addhelper @user` | Add someone to the helpers list |
| `/pixl-removehelper @user` | Remove someone from the helpers list |
| `/pixl-helpers` | List all current helpers |
| `/pixl-remember [fact]` | Teach Pixorpheus a fact about the server - injected into every AI reply (Gabin can also use this) |
| `/pixl-forget [number]` | Remove a stored memory entry by number |
| `/pixl-memories` | List all stored server memories |

---

## Inline Commands (pixo:)

These are typed directly in a message (not slash commands). They only work in channels where Pixorpheus has access - **private channels or channels it's been added to**.

| Command | Where | Description |
|---|---|---|
| `pixo:kawaii` | Any channel Pixorpheus is in | Start listening mode - Pixorpheus begins collecting messages in that channel to learn the writing style |
| `pixo:notkawaii` | Same channel | Stop listening mode - processes the collected messages and saves the speaking style |
| `pixo:kawaii?` | Anywhere | Check if listening mode is active - shows the channel and how many messages have been collected (ephemeral) |
| `pixo:recap` | Any channel | Summarize the last 6 hours of messages in the channel, shown only to you (ephemeral). Use `pixo:recap today` to summarize since midnight, `pixo:recap 2h` for a custom timeframe (supports `min`, `h`, `d`). In a thread, it summarizes the thread instead. |
| `pixo:compact` (also `pixo /compact`, `@Pixorpheus /compact`) | Any channel | Compact the day: summarizes everything since local midnight in that channel, posted as a real threaded reply (visible to everyone, not ephemeral). Use `pixo:compact yesterday` for the previous day's compact, pulled from the stored daily compact if one exists, computed live otherwise. Every day, right after midnight, Pixorpheus also silently generates and stores a compact of #pixl for the day that just ended (nothing is posted); this is what `pixo:compact yesterday` reads back. |

> Only one listening session can be active at a time. Starting a new one in a different channel resets the previous one.

There's also a special delete feature: react with `:pixl-delete:` to any Pixorpheus message and it will delete itself.

---

## Thread Controls

Type these anywhere in a thread to control Pixorpheus's behavior:

| Command | Effect |
|---|---|
| `PIXOSTOP` | Mute Pixorpheus in the current thread - it will stop replying unless directly mentioned |
| `PIXOSTART` | Unmute Pixorpheus in the current thread |

---

## AI System

### How It Works

Pixorpheus replies to messages when:
1. Someone mentions it by name (`pixorpheus`, `pixo`, `pix`)
2. Someone directly @mentions it (`@pixorpheus`)
3. It decides to jump in uninvited if there's a genuinely good opening (chime mode - ~45% chance it acts on it)
4. Someone DMs it

Messages are batched for 1.5 seconds (if mentioned) or 8 seconds (if chiming) to avoid replying to every single message in a fast conversation.

### Models

| Use case | Model |
|---|---|
| Main channel replies | `claude-sonnet-4-5` via OpenRouter |
| DMs | `claude-haiku-4-5` via Anthropic SDK (with web search) |
| Utility tasks (chime decision, memory extraction, search query) | `deepseek/deepseek-v4-pro` via OpenRouter |
| Urban Dictionary filtering | `deepseek/deepseek-v4-pro` via OpenRouter |

### Memory System

Pixorpheus automatically learns about people over time:

- **Facts** - extracted from every conversation (name, projects, skills, interests, etc.). Stored per user in PostgreSQL. Up to 100 facts per person.
- **Personality traits** - extracted 20% of the time, capturing communication style (blunt, enthusiastic, chaotic, etc.)
- **Server memory** - facts about the Pixl program added via `/pixl-remember` - injected into every AI reply
- **Style notes** - learned from the listening/training system (see below) - also injected into every reply

All of this is fed into the system prompt before every reply, so Pixorpheus always has context on who it's talking to.

### Web Search

Pixorpheus automatically searches the web (via Brave Search API) when a message seems to need up-to-date info - current events, news, prices, recent releases, etc. It decides whether to search before replying.

### Custom Emojis

Pixorpheus has a full list of custom Slack emojis it knows about and uses in messages when contextually appropriate:

`:wiltedrose:` `:yay:` `:loll:` `:sad-pf:` `:skulk:` `:noooovanish:` `:angy:` `:yesyes:` `:blobhaj_party:` `:shocked:` `:upvote:` `:lets-fucking-gooo:` `:huh3d:` `:thumbs-up:` `:3c:` `:byee:` `:hii:` `:nono:` `:hehehe:` `:awww:` `:alibaba-admire:` `:alibaba-grin:` `:cryign:` `:heavysob:` `:brokenheart:` `:nyan:` `:cat-gun:` `:isob:` `:sob-pray:` `:agadance:` `:cat-woah:` `:cat-heart:` `:communist:` `:eyes_wtf:` `:eyes_shaking:` `:eyes-out-of-head:` `:orpheus-love:` `:orpheus-baguette:` `:orphanage:` `:orpheus-explode:` `:hyper-dino-wave:` `:pepedyingoflaughter:` `:pet-gabin:` `:pet-ridit:` `:pet-maxx:` `:yapa:` `:yay-gay:` `:wagay:` `:gay-flag:` `:bhjflag_gay:` `:spinny_cat_gay:` `:1984:`

It can also react to messages with these emojis (the AI decides when it's appropriate).

### Special Behaviors

- **Orpheus bot** - automatically replies "thx orphan" immediately whenever Orpheus posts in the same channel
- **New members** - posts a random welcome message when someone joins the Pixl channel (`#pixl`) and pings Gabin in the thread
- **Short replies** - the bot is trained to reply like someone actually texting: 2–8 words most of the time

---

## Docs Answers & Smart FAQ

Pixorpheus can answer questions straight from the Pixl **docs** and the landing **FAQ**, and remembers what it has already answered so repeat questions are instant.

### How it works (`src/ai/docs.ts`, `src/ai/answerFromDocs.ts`)

1. **Docs are fetched, never hardcoded into the prompt.** On demand, pixo fetches the docs pages (`https://pixl.hackclub.com/docs/*`) and the landing FAQ, strips them to text, and caches that corpus **in memory** (6h TTL). The docs text is only ever passed to a dedicated "answer from docs" model call, it is **never** added to the main chat system prompt, so ordinary messages don't pay the doc token cost. Override the sources with `PIXL_DOCS_URL` / `PIXL_LANDING_URL`.
2. **Answered-questions cache (`pixo_qa_cache` table).** Before fetching anything, pixo checks the questions it has already answered (exact + token-overlap match). A hit is returned instantly with no docs fetch and no model call. Fresh answers are stored so the next similar question is a cache hit.
3. **If the docs don't cover it**, the answer step returns nothing, the signal to fall back to a human helper.

### In the help channel

When a new question is posted, pixo posts a quick placeholder, then edits it in place:

- **Docs have the answer** → the answer is posted (with a link to the docs), and a helper can still follow up.
- **Docs don't cover it** → "just wait for a helper to respond to this one :D", and pixo also surfaces a **similar previously-resolved ticket** if there is one (last 60 closed tickets, semantic match, the older Smart FAQ behavior, now a fallback).

The ticket is still created normally either way.

- **Language:** English only (the bot reminds users to post in English if needed)
- **Threshold:** Only high-confidence similar-ticket matches are surfaced - vague similarity is ignored

---

## Auto-Close

Tickets that have been open for more than **5 days** with no activity are automatically closed.

### Rules

- A ticket qualifies if: it has been open for 5+ days AND the last message in the thread is also 5+ days old
- At closure, Pixorpheus posts a message in the thread explaining the ticket was auto-closed due to inactivity, and tells the user to open a new ticket if the issue is still relevant
- The ticket channel message is updated to show the resolved status

Auto-close runs once at startup and once every 24 hours.

---

## Help & Ticket System

This is the core support system for the Pixl program.

### Flow

1. **User posts in the help channel** →
   - Pixorpheus adds a 🤔 reaction to the message
   - Posts a placeholder thread reply, then edits it into either a **docs answer** or "just wait for a helper to respond to this one :D" (see [Docs Answers & Smart FAQ](#docs-answers--smart-faq)) + a "Mark as resolved" button
   - Sends the user an ephemeral message asking them to set a title for their ticket ("Set title" / "Skip" buttons)

2. **Title modal** (optional) →
   - If the user clicks "Set title", a modal opens with a text input (max 100 chars)
   - Submit → ticket created with the title
   - Close/Skip → ticket created without a title
   - If the user ignores the ephemeral for **3 minutes**, the ticket is created automatically without a title

3. **Ticket appears in the private ticket channel** with:
   - Status line: `🔴 Open - not claimed` / `🟡 Claimed by @X` / `✅ Resolved by @X`
   - Buttons: **Claim** (or Unclaim) + **Mark Resolved** - or **Reopen** if closed
   - The ticket title (or the first 80 characters of the message if no title)
   - Author mention
   - Quoted description
   - **View in Slack** button (direct link to the thread)
   - Ticket number at the bottom

### Actions Available

| Where | Action | Who can do it |
|---|---|---|
| Help channel thread | Mark as resolved (button) | Ticket author, helpers, support team |
| Help channel thread | `?resolve` or `?close` macro | Helpers only |
| Help channel thread | `?faq` macro | Helpers only - posts FAQ link and resolves |
| Help channel thread | `?reopen` macro | Helpers only |
| Ticket channel | Claim / Unclaim | Helpers and support team |
| Ticket channel | Mark Resolved | Helpers and support team |
| Ticket channel | Reopen | Helpers and support team |
| Dashboard | Reply to thread | Helpers (appears as their name) |
| Dashboard | Mark Resolved | Helpers |

Thread macros are typed as the **first word** in a thread reply (e.g. `?resolve` - the message is automatically deleted after running).

### Status Updates

When a ticket is resolved or reopened, the message in the ticket channel is automatically updated with the new status and buttons. The help channel thread always gets a notification message.

Reactions on the original message: 🤔 = open, ✅ = resolved.

---

## Style Listening System

> ⚠️ Only works in channels where Pixorpheus has been added (private channels or channels it's a member of).

This system lets you train Pixorpheus's speaking style from real conversations.

### How to use

1. Type `pixo:kawaii` in a channel - Pixorpheus confirms it's watching
2. Talk normally in that channel - it collects all messages
3. Type `pixo:notkawaii` when done - Pixorpheus processes the messages and saves the style
4. From now on, the style notes are injected into every AI reply

Only one listening session can be active at a time. Minimum 5 messages needed to process.

### Check status

Type `pixo:kawaii?` anywhere - you'll get an ephemeral showing whether listening mode is on, which channel, and how many messages collected.

---

## Training Mode

A more explicit style training flow, available only in the designated training channel (`TRAINING_CHANNEL` env var, hardcoded as `C0BD7JSTQNM`).

| Command | Effect |
|---|---|
| `pixo:child labor training` | Start training mode - Pixorpheus watches every message in the channel |
| `pixo:stop child labor training` | Stop training - processes all collected messages and saves the style |

Requires at least 5 messages. The extracted style overwrites the previous style notes (same DB table as the listening system).

---

## Dashboard

Helper/admin ticket moderation now lives in `apps/dashboard` (the Next.js admin dashboard elsewhere in this monorepo), not in this app. It talks to the same Supabase database directly and calls `POST /api/external/tickets/:ts/resolve` on this bot (see `src/external/ticketApi.ts`) to resolve tickets through Slack, since this bot is reliably a member of the help channel.

---

## Database

Tables (`tickets`, `helpers`, `user_memory`, `user_personality`, `program_memory`, `polls`, `style_memory`) are created via Supabase migrations, not at runtime.

| Table | Purpose |
|---|---|
| `user_memory` | Per-user fact arrays (JSONB) - up to 100 facts per person |
| `user_personality` | Per-user personality trait arrays (JSONB) |
| `program_memory` | Server-wide facts injected into every AI reply |
| `polls` | Active timed polls |
| `style_memory` | Speaking style notes (one active row) |
| `helpers` | Slack user IDs of support team members |
| `tickets` | All ticket records |

### `tickets` table columns

| Column | Type | Description |
|---|---|---|
| `msg_ts` | TEXT (PK) | Slack timestamp of the original help message |
| `ticket_msg_ts` | TEXT | Slack timestamp of the ticket channel message |
| `description` | TEXT | Full text of the original message |
| `title` | TEXT | Optional title set by the user |
| `status` | TEXT | `open` or `closed` |
| `opened_by_slack_id` | TEXT | Author of the original message |
| `claimed_by_slack_id` | TEXT | Helper who claimed the ticket |
| `closed_by_slack_id` | TEXT | Who resolved it |
| `closed_at` | TIMESTAMP | When it was resolved |
| `last_msg_at` | TIMESTAMP | Last activity in the thread |
| `permalink` | TEXT | Direct Slack link to the original message |
| `ticket_number` | INTEGER | Auto-incremented ticket number |

---

## Environment Variables

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Slack bot OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_HELP_CHANNEL` | Channel ID of the help channel where users post questions |
| `SLACK_TICKET_CHANNEL` | Channel ID of the private ticket channel for the support team |
| `SLACK_FAQ_URL` | URL to the FAQ (linked in the "Someone will be here soon!" message) |
| `SLACK_ADMIN_USER_IDS` | Comma-separated Slack user IDs of admins (bypass helper checks) |
| `SLACK_USER_TOKEN` | User token (`xoxp-...`) for deleting macro messages in threads |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Supabase project URL + service key (shared with the other apps in this monorepo) |
| `OPENROUTER_API_KEY` | OpenRouter API key (main AI + utility models) |
| `PIXO_MODEL` | Overrides the default OpenRouter model (`google/gemini-3.1-flash-lite:nitro`) |
| `BRAVE_SEARCH_KEY` | Brave Search API key (auto web search in replies) |
| `PIXL_DOCS_URL` | Base URL of the Pixl docs pixo answers from (default `https://pixl.hackclub.com/docs`) |
| `PIXL_LANDING_URL` | Landing URL pixo pulls the FAQ text from (default `https://pixl.hackclub.com`) |
| `PIXL_LOGS_CHANNEL_ID` | Skips the `#pixl-logs` channel-name scan (see `src/slack/logs.ts`) |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for the `/webhooks/github` route. **Required** - without it the route returns 503 and processes nothing |
| `GITHUB_NOTIFY_CHANNEL` | Channel ID to post GitHub push/merge notifications to |
| `SHOP_WEBHOOK_SECRET` | Shared secret for the `/webhooks/shop` route, sent by Supabase as the `x-shop-webhook-secret` header. **Required** - without it the route returns 503 and processes nothing |
| `SHOP_NOTIFY_CHANNEL` | Channel ID to post shop item change notifications to (defaults to `#shop-changes`) |
| `EXTERNAL_API_KEY` | API key `apps/dashboard` uses to call `/api/external/tickets/:ts/resolve` |
| `PORT` | Port for the Bolt HTTP receiver (default 3000) |

---

## Deployment

Pixorpheus runs as a single **Bun** process (`bun run src/index.ts` / `bun run start`), no build step. It's deployed on **Railway**, sharing its Supabase database with the rest of the monorepo, and auto-deploys from GitHub pushes to `main`.

The Slack app must have the following **event subscriptions** enabled:
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`
- `reaction_added`
- `member_joined_channel`

And the following **slash commands** registered pointing to the bot's URL.
