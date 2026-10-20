<div align="center">

<h1><img src=".github/readme-assets/header-wordmark.png" alt="Pixl" width="360"></h1>

**A multiplayer open-world YSWS program by [Hack Club](https://hackclub.com).**
</div>

<br>

## Description

PIXL is a **YSWS** (You ship, We ship) program by [Hack Club](https://hackclub.com). It's created by [Gabin](https://hackclub.enterprise.slack.com/team/U0A2SJ7B739), [Ridit](https://hackclub.enterprise.slack.com/team/U0ARC79GEAV) and [Ricky](https://hackclub.enterprise.slack.com/team/U0A1VPETCR3) and *sponsored* by [Seba](https://hackclub.enterprise.slack.com/team/U087BHR98AX), on behalf of **Hack Club** to make it an **official program**!
It started august 18th and is ending January 1st!
You basically evolve in a **multiplayer open world** to discover regions and go talk to **NPCs** that will give you trials (prompted projects) for you to do and that will help to **rebuild the civilisation**. The whole story is explained during the cinematic when you enter the game for the first time so if that feels vague to you, ***go play that cinematic***!

You can also create **general projects** and submit them as well!

You earn pixels from your hours and with those pixels, you can buy a ton of **crazy stuff** from our [huge shop](https://pixl.hackclub.com/shop)!

## Screenshots

<div align="center">
  <img src=".github/readme-assets/landing-hero.jpg" alt="Pixl landing page" width="49%">
  <img src=".github/readme-assets/landing-shop.jpg" alt="The Pixl shop" width="49%">
</div>

<br>

## Getting Started

### Dependencies

- [Bun](https://bun.sh) 1.3.13 or newer (the version pinned in `package.json`)
- [Git](https://git-scm.com)
- [Postgres](https://www.postgresql.org) for `apps/server` and `apps/internal-dashboard`
- [Godot 4](https://godotengine.org) if you want to work on `apps/game`
- Credentials for the services an app uses (Slack, Hack Club Auth, and so on). Check that app's `.env.example`.

### Installing

Clone the repository and install every workspace's dependencies from the repo root:

```bash
git clone https://github.com/hackclub/pixl.git
cd pixl
bun install
```

Each app has its own `.env`. Copy the example for the apps you want to run and fill in the values you have access to:

```bash
cp apps/server/.env.example apps/server/.env
cp apps/internal-dashboard/.env.example apps/internal-dashboard/.env
cp apps/pixl-dashboard/.env.example apps/pixl-dashboard/.env
cp apps/pixorpheus/.env.example apps/pixorpheus/.env
```

If you don't have database or Slack credentials, ask in the `#pixl` channel on [Hack Club Slack](https://hackclub.com/slack). Many frontend contributions to `apps/landing` or `apps/game` don't need a full backend running.

### Executing program

Start every app's dev server at once:

```bash
bun run dev
```

Or start a single app:

```bash
bun run internal-dashboard   # internal review/moderation dashboard, http://localhost:4900
bun run pixl-dashboard       # player dashboard, http://localhost:4901
```

Useful repo-wide commands:

```bash
bun run build                              # build every app
bun run --cwd apps/internal-dashboard test # run one app's tests
```

To run `apps/game`, open the project in the Godot 4 editor. It is not a Bun app, so don't run `bun install` in that folder.

## Help

- Read [DEVELOPER.md](DEVELOPER.md) for the architecture, local setup and deployment notes.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.
- Ask in the `#pixl` channel on [Hack Club Slack](https://hackclub.com/slack).
- [Open an issue](https://github.com/hackclub/pixl/issues) for bugs or feature requests.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
