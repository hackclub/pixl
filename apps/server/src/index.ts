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
import npsRouter from "./routes/nps.js";
import vaultRouter from "./routes/vault.js";
import storyRouter from "./routes/story.js";
import villageRouter from "./routes/village.js";
import upvotesRouter from "./routes/upvotes.js";
import ideasRouter from "./routes/ideas.js";
import referralRouter from "./routes/referral.js";
import collaboratorsRouter from "./routes/collaborators.js";
import activityRouter from "./routes/activity.js";
import newsRouter from "./routes/news.js";
import resultsRouter from "./routes/results.js";
import showNTellRouter from "./routes/showNTell.js";
import formsRouter from "./routes/forms.js";
import operationsRouter from "./routes/operations.js";
import journalsPublicRouter from "./routes/journalsPublic.js";
import macondoRouter from "./macondo/routes.js";
import yswsRouter from "./ysws/routes.js";
import { rateLimit } from "./rateLimit.js";
import { originGuard } from "./http/origins.js";
import { adminServiceGate } from "./http/serviceKeys.js";
import { auditApiRequests, authGate } from "./http/gate.js";
import { blockQueueCrawlers } from "./http/queueCrawlers.js";
import { rateLimitKeyFor } from "./http/clientKey.js";
import { attachWebSocketServer } from "./ws/gameServer.js";
import { startLittleGuyForwarder } from "./littleGuy.js";

const app = express();
app.disable("x-powered-by");

// Trust exactly one hop (the platform's ingress/edge proxy) so req.ip is the
// proxy-appended real client address, not whatever a client stuffs into its
// own X-Forwarded-For, Express reads XFF from the right by this many hops,
// so a spoofed prefix a client sends is ignored rather than trusted.
app.set("trust proxy", 1);

// Security headers + origin allowlist (http/origins.ts). Only
// config.urls.site/play/dash get CORS; any other Origin is a 403.
app.use(originGuard());
// Known unofficial queue crawlers. Cheap to check, and it keeps them from
// hammering the per-id probe path while the public data they used is gone.
app.use(blockQueueCrawlers());

// Keyed per player for authenticated calls, per client IP otherwise (see
// http/clientKey.ts).
app.use(rateLimit({ windowMs: 60_000, max: 300, name: "all", key: rateLimitKeyFor }));
const writeLimiter = rateLimit({ windowMs: 60_000, max: 60, name: "write", key: rateLimitKeyFor });
app.use((req, res, next) =>
  req.method === "GET" ? next() : writeLimiter(req, res, next),
);

// Upload routes keep their own express.raw() limits; this only governs JSON.
app.use(express.json({ limit: "256kb" }));
app.use(auditApiRequests());
// /api/admin/* answers only to a service key (x-pixl-service-key), never to
// a player session. Mounted via app.use so it shares Express's own path
// matching with the admin routes behind it.
app.use("/api/admin", adminServiceGate());
// Deny by default: everything not in http/publicRoutes.ts needs a Bearer
// session, which also runs the revocation and active-ban checks.
app.use(authGate());
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
app.use(npsRouter);
app.use(vaultRouter);
app.use(storyRouter);
app.use(villageRouter);
app.use(upvotesRouter);
app.use(ideasRouter);
app.use(referralRouter);
app.use(collaboratorsRouter);
app.use(activityRouter);
app.use(newsRouter);
app.use(resultsRouter);
app.use(showNTellRouter);
app.use(formsRouter);
app.use(operationsRouter);
app.use(journalsPublicRouter);
app.use(macondoRouter);
app.use(yswsRouter);

app.get("/", (_req, res) => res.json({ name: "pixl-server", status: "ok" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use((_req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// This is a pure JSON API, nothing upstream turns a thrown error into JSON,
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

void startLittleGuyForwarder();
