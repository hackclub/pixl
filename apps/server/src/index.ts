import "dotenv/config";
import express from "express";
import { createServer } from "http";
import authRouter from "./routes/auth.js";
import hackatimeRouter from "./routes/hackatime.js";
import projectsRouter from "./routes/projects.js";
import notificationsRouter from "./routes/notifications.js";
import profileRouter from "./routes/profile.js";
import friendsRouter from "./routes/friends.js";
import uploadsRouter from "./routes/uploads.js";
import exploreRouter from "./routes/explore.js";
import adminRouter from "./routes/admin.js";
import shopRouter from "./routes/shop.js";
import eventsRouter from "./routes/events.js";
import sidequestsRouter from "./routes/sidequests.js";
import npcsRouter from "./routes/npcs.js";
import reportsRouter from "./routes/reports.js";
import vaultRouter from "./routes/vault.js";
import storyRouter from "./routes/story.js";
import villageRouter from "./routes/village.js";
import upvotesRouter from "./routes/upvotes.js";
import ideasRouter from "./routes/ideas.js";
import referralRouter from "./routes/referral.js";
import collaboratorsRouter from "./routes/collaborators.js";
import activityRouter from "./routes/activity.js";
import newsRouter from "./routes/news.js";
import yswsRouter from "./ysws/routes.js";
import { rateLimit } from "./rateLimit.js";
import { attachWebSocketServer } from "./ws/gameServer.js";

const app = express();
app.disable("x-powered-by");

// Trust exactly one hop (the platform's ingress/edge proxy) so req.ip is the
// proxy-appended real client address, not whatever a client stuffs into its
// own X-Forwarded-For — Express reads XFF from the right by this many hops,
// so a spoofed prefix a client sends is ignored rather than trusted.
app.set("trust proxy", 1);

// CORS: the web export (served from another origin, with COEP require-corp)
// reaches us via the browser's fetch, which enforces CORS. Tokens travel in the
// query string, not cookies, so a permissive origin is safe here.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Cross-Origin-Resource-Policy", "cross-origin");
  // Session tokens travel in the query string (see the comment above). A
  // same-origin navigation would otherwise forward the full URL — token
  // included — as the Referer header on any subresource request it makes.
  res.header("Referrer-Policy", "no-referrer");
  // This is a pure JSON API, never HTML — a locked-down CSP/frame policy
  // costs nothing and closes off any accidental HTML error response as an
  // XSS/clickjacking vector.
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.header("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(rateLimit({ windowMs: 60_000, max: 300, name: "all" }));
const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, name: "write" });
app.use((req, res, next) =>
  req.method === "GET" ? next() : writeLimiter(req, res, next),
);

app.use(express.json());
app.use(authRouter);
app.use(hackatimeRouter);
app.use(projectsRouter);
app.use(notificationsRouter);
app.use(profileRouter);
app.use(friendsRouter);
app.use(uploadsRouter);
app.use(exploreRouter);
app.use(adminRouter);
app.use(shopRouter);
app.use(eventsRouter);
app.use(sidequestsRouter);
app.use(npcsRouter);
app.use(reportsRouter);
app.use(vaultRouter);
app.use(storyRouter);
app.use(villageRouter);
app.use(upvotesRouter);
app.use(ideasRouter);
app.use(referralRouter);
app.use(collaboratorsRouter);
app.use(activityRouter);
app.use(newsRouter);
app.use(yswsRouter);

app.get("/", (_req, res) => res.json({ name: "pixl-server", status: "ok" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

// This is a pure JSON API — nothing upstream turns a thrown error into JSON,
// so without this an oversized/malformed body (e.g. body-parser's raw-size
// limit) falls through to Express's default HTML error page, which every
// client here parses with res.json() and silently treats as "went wrong".
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) return next(err);
    const type = (err as { type?: string } | null)?.type;
    if (type === "entity.too.large") {
      return res.status(413).json({ ok: false, error: "file_too_large" });
    }
    if (type === "entity.parse.failed") {
      return res.status(400).json({ ok: false, error: "bad_request" });
    }
    console.error("[server] unhandled error", err);
    res.status(500).json({ ok: false, error: "server_error" });
  },
);

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = "0.0.0.0";
httpServer.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
