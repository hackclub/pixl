# pixl-server

Backend server for **Pixl**, a multiplayer 2D game (the client is built in Godot).

`pixl-server` powers authentication, realtime multiplayer, social features, and coding-time integrations over HTTP and WebSockets. It is written in TypeScript, runs on Node.js as an ESM application, and uses Supabase for persistence.

## Features

- **Authentication** - Hack Club OAuth, plus an optional demo login for local development.
- **Realtime multiplayer** - movement, chat, proximity voice, emotes, and presence over WebSockets.
- **Instanced lobbies** - in-memory and persisted lobby management with shared rooms and private password-protected lobbies.
- **Scene system** - village, openworld, and house scenes with per-scene persisted player and NPC positions.
- **Friends & DMs** - friend requests, friend pairs, player search, and direct messaging.
- **Projects** - per-user projects linked to Hackatime coding-time tracking.
- **Notifications** - a per-user inbox plus admin broadcast messaging.
- **Moderation** - profanity filtering, a violation log, and bans with a periodic ban-sweep that kicks players banned mid-session.

## Tech Stack

- **Language:** TypeScript (ESM) on Node.js
- **HTTP:** [Express 4](https://expressjs.com/)
- **Realtime:** [`ws`](https://github.com/websockets/ws) WebSocket server
- **Data:** [Supabase](https://supabase.com/) via `@supabase/supabase-js`, using the `service_role` key (server-only; bypasses RLS)
- **Dev runtime:** [`tsx`](https://github.com/privatenumber/tsx) for watch/dev; `tsc` build to `dist/`, run with `node`
- **Package managers:** works with npm or Bun (both lockfiles are present)

## Project Structure

```
src/
├── index.ts                 # Entry point (Express + WS bootstrap)
├── auth/session.ts          # JWT session issue/verify
├── db/client.ts             # Supabase service client + row types
├── social.ts                # Friend-pair helpers
├── moderation.ts            # Profanity filter, violation log, ban checks
├── hackatime/api.ts         # Hackatime API client
├── ws/
│   ├── gameServer.ts        # WebSocket realtime game server
│   └── lobbies.ts           # In-memory + persisted lobby management
└── routes/
    ├── auth.ts              # Demo + Hack Club OAuth login
    ├── hackatime.ts         # Hackatime OAuth connect + stats
    ├── projects.ts          # CRUD for user projects
    ├── notifications.ts     # User inbox + admin broadcast
    ├── profile.ts           # Display-name change (profanity-guarded)
    └── friends.ts           # Friends, requests, player search, profiles
```

## Getting Started

### Prerequisites

- Node.js (with npm) or [Bun](https://bun.sh/)
- A Supabase project (URL + `service_role` key)

### Install

Using npm:

```bash
npm install
```

Using Bun:

```bash
bun install
```

### Configure environment

Copy the example environment file and fill in the values:

```bash
cp .env.example .env
```

See [Environment Variables](#environment-variables) for the full list.

### Run

Development (watch mode):

```bash
npm run dev
```

Build and run in production:

```bash
npm run build
npm start
```

The server listens on `PORT` (default `3000`).

## Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL | - |
| `SUPABASE_SERVICE_KEY` | Supabase `service_role` key (server-only) | - |
| `JWT_SECRET` | Signing secret for session tokens | - |
| `HCA_CLIENT_ID` | Hack Club OAuth client ID | - |
| `HCA_CLIENT_SECRET` | Hack Club OAuth client secret | - |
| `HCA_REDIRECT_URI` | Hack Club OAuth redirect URI | `http://localhost:3000/auth/hackclub/callback` |
| `HACKATIME_BASE` | Hackatime API base URL | - |
| `HACKATIME_CLIENT_ID` | Hackatime OAuth client ID | - |
| `HACKATIME_CLIENT_SECRET` | Hackatime OAuth client secret | - |
| `HACKATIME_REDIRECT_URI` | Hackatime OAuth redirect URI | `https://server.pixl.rsvp/hackatime/callback` |
| `HACKATIME_SCOPES` | Hackatime OAuth scopes | - |
| `ADMIN_API_KEY` | Key for the admin notifications endpoint | - |
| `DATABASE_URL` | Postgres URL used by the Drizzle tooling | - |
| `PORT` | Port the server listens on | `3000` |
| `ALLOW_DEMO_LOGIN` | Enables the demo login route when `true` | - |

## HTTP API

### Meta

- `GET /` → `{ name, status }`
- `GET /health` → `{ ok: true }`

### Authentication

- `GET /auth/demo?name=` - demo login (only when `ALLOW_DEMO_LOGIN=true`)
- `GET /auth/hackclub` - begin Hack Club OAuth
- `GET /auth/hackclub/callback` - Hack Club OAuth callback; blocks banned users and redirects back to the client with `token`/`name` (and `new=1` for new users)

### Hackatime

- `GET /hackatime/connect`
- `GET /hackatime/callback`
- `GET /api/hackatime/stats`

### Projects

- `GET /api/projects[/:id]`
- `POST /api/projects`
- `PUT /api/projects/:id`
- `DELETE /api/projects/:id`

### Notifications

- `POST /api/admin/notifications` - admin send (auth via `x-api-key` header or `?key=`); supports per-user or broadcast
- `GET /api/notifications` - user inbox
- `POST /api/notifications/read` - mark as read

### Profile

- `POST /api/profile/name` - change display name (profanity-guarded)

### Friends & Players

- `GET /api/friends`
- `POST /api/friends/request`
- `POST /api/friends/accept`
- `POST /api/friends/remove`
- `GET /api/players/search?q=`
- `GET /api/players/profile?userId=`

## WebSocket API

Connect at:

```
/ws?token=<jwt>
```

### Inbound message types

`move`, `change_scene`, `set_skin`, `chat`, `dm`, `emote`, `lobby_list`, `lobby_create`, `lobby_join`, `lobby_quick_join`, `lobby_join_friend`, `lobby_manage`, `save_npcs`.

Binary frames are relayed as proximity voice.

### Server-emitted message types

`init`, `player_joined`, `player_moved`, `player_left`, `player_skin`, `chat`, `dm`, `emote`, `npc_init`, `lobby_joined`, `lobby_denied`, `lobby_closed`, `lobby_list`.

### Notes

- `village` is a private per-player room (`village:<userId>`).
- Lobbies are shared rooms (`lobby:<CODE>`), capped at 16 players per lobby, with a maximum of 200 lobbies. Private lobbies use a 4-digit password.
- Player positions are persisted per `(user, scene)` every 5 seconds.

## Database

Persistence is provided by Supabase. Runtime queries use the Supabase client directly (no ORM at runtime).

Tables referenced:

- `users`
- `player_state`
- `npc_state`
- `projects`
- `notifications`
- `friends`
- `bans`
- `violations`
- `lobbies`

## Scripts

| Script | Command | Description |
| --- | --- | --- |
| `dev` | `tsx watch src/index.ts` | Run the server in watch mode |
| `build` | `tsc -p tsconfig.json` | Compile TypeScript to `dist/` |
| `start` | `node dist/index.js` | Run the compiled server |
| `db:generate` | `drizzle-kit generate` | Generate Drizzle migrations |
| `db:migrate` | `drizzle-kit migrate` | Apply Drizzle migrations |
| `db:studio` | `drizzle-kit studio` | Open Drizzle Studio |

## Notes / Known Limitations

- The `service_role` key bypasses Supabase Row Level Security and must never be exposed to clients - keep it server-side only.
- Drizzle tooling (`drizzle-orm` / `drizzle-kit`, `drizzle.config.ts`, and the `db:*` scripts) is scaffolded and points at `./src/db/schema.ts`, but that schema file does not exist yet. As a result the migration tooling is **not functional as-is**. Authoring `src/db/schema.ts` is a planned follow-up; until then, runtime persistence relies entirely on the Supabase client.

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 Pixl.
