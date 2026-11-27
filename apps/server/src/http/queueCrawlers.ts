import type { NextFunction, Request, Response } from "express";

// Unofficial queue trackers announce themselves. This is a speed bump, not a
// security boundary: the real protection is that in-review projects and
// anonymous review history are no longer public. A crawler that changes its
// User-Agent still cannot rebuild queue positions from the public API.
const BLOCKED_AGENT_PARTS = ["pixl-queue", "reviewq", "review-q"];

export function isQueueCrawlerUserAgent(ua: string | string[] | undefined): boolean {
  const value = Array.isArray(ua) ? ua.join(" ") : (ua ?? "");
  const lower = value.toLowerCase();
  return BLOCKED_AGENT_PARTS.some((part) => lower.includes(part));
}

export function blockQueueCrawlers() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isQueueCrawlerUserAgent(req.headers["user-agent"])) {
      res.status(403).json({ ok: false, error: "blocked_user_agent" });
      return;
    }
    next();
  };
}
