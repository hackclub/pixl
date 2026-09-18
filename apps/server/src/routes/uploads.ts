import express, { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { supabase } from "../db/client.js";
import { checkImageSafe, MAX_MODERATE_BYTES } from "../imageModeration.js";
import { isRealImage } from "../imageValidation.js";
import { consumeRateLimit, type RateLimitOptions } from "../rateLimit.js";
import { validateBomCsv, sanitizeBomCsv } from "./bomCsv.js";
import { CDN_UPLOAD_QUOTA, reserveCdnUploadQuota, releaseCdnUploadQuota } from "./cdnQuota.js";

const router = Router();

// No image/gif: YSWS submission guidelines require screenshots to be static,
// not animated or video.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Proxy image uploads to the Hack Club CDN so the key stays server-side.
router.post(
  "/api/uploads",
  express.raw({ type: IMAGE_TYPES, limit: MAX_MODERATE_BYTES }),
  async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const session = token ? verifySessionToken(token) : null;
    if (!session) return res.status(401).json({ ok: false });

    const key = process.env.HACKCLUB_CDN_KEY;
    if (!key) {
      console.error("[uploads] HACKCLUB_CDN_KEY is not set, refusing upload");
      return res.status(503).json({ ok: false, error: "cdn_not_configured" });
    }

    // express.json() runs globally before this router, so a request sent with a
    // JSON content-type reaches here with req.body already parsed into an object
    // or array, express.raw() only populates a Buffer for IMAGE_TYPES. Narrow
    // rather than asserting `as Buffer`, which is a lie on that path.
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim();
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || buf.length === 0) {
      // This is the one failure mode with no signal at all on the client side
      // (Pixl.upload just throws "upload_failed" -> a generic toast), so log
      // enough here to tell "wrong file type" apart from "no body sent".
      console.error(
        "[uploads] no image body parsed, content-type was",
        JSON.stringify(contentType || "(none)"),
      );
      if (contentType && !IMAGE_TYPES.includes(contentType))
        return res.status(415).json({ ok: false, error: "unsupported_type" });
      return res.status(400).json({ ok: false, error: "empty_body" });
    }

    const type = String(req.headers["content-type"] ?? "image/png");

    if (!(await isRealImage(buf, type))) {
      return res.status(400).json({ ok: false, error: "invalid_image" });
    }

    // Moderation must finish, and pass, before the bytes ever reach the CDN -
    // an image cdn.hackclub.com has stored is public and durable, so a
    // rejected image must never be uploaded at all, not just withheld from
    // the response.
    const safety = await checkImageSafe(buf, type);
    if (!safety.safe) {
      return res
        .status(400)
        .json({ ok: false, error: "image_rejected", reason: safety.reason });
    }

    const quota = reserveCdnUploadQuota(CDN_UPLOAD_QUOTA, session.userId, buf.length);
    if (!quota.ok) {
      res.setHeader("Retry-After", quota.retryAfterSeconds);
      return res.status(429).json({ ok: false, error: "quota_exceeded" });
    }

    const ext = type === "image/jpeg" ? "jpg" : (type.split("/")[1] ?? "png");
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buf)], { type }),
      `journal-${Date.now()}.${ext}`,
    );

    let cdnUrl: string | null;
    try {
      const r = await fetch("https://cdn.hackclub.com/api/v4/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!r.ok) {
        console.error("[uploads] cdn rejected", r.status, await r.text());
        cdnUrl = null;
      } else {
        const json = (await r.json()) as { url?: string };
        if (!json.url) console.error("[uploads] cdn response missing url", json);
        cdnUrl = json.url ?? null;
      }
    } catch (e) {
      console.error("[uploads] cdn upload failed", e);
      cdnUrl = null;
    }

    if (!cdnUrl) {
      releaseCdnUploadQuota(CDN_UPLOAD_QUOTA, session.userId, buf.length);
      return res.status(502).json({ ok: false, error: "cdn_failed" });
    }
    res.json({ ok: true, url: cdnUrl });
  },
);

const CSV_TYPES = ["text/csv", "application/vnd.ms-excel", "application/csv"];
const MAX_CSV_BYTES = 512 * 1024;
const BOM_ACCOUNT_LIMIT: RateLimitOptions = {
  windowMs: 24 * 60 * 60 * 1000,
  max: 20,
  name: "bom_upload_account",
};
const BOM_PROJECT_LIMIT: RateLimitOptions = {
  windowMs: 60 * 60 * 1000,
  max: 5,
  name: "bom_upload_project",
};

router.post(
  "/api/projects/:projectId/bom",
  express.raw({ type: CSV_TYPES, limit: MAX_CSV_BYTES }),
  async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const session = token ? verifySessionToken(token) : null;
    if (!session) return res.status(401).json({ ok: false });

    const projectId = Number(req.params.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0)
      return res.status(400).json({ ok: false, error: "project_not_found" });
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (projectError) {
      console.error("[uploads] bom project lookup failed", projectError);
      return res.status(500).json({ ok: false });
    }
    if (!project) return res.status(404).json({ ok: false, error: "project_not_found" });
    const accountRetryAfter = consumeRateLimit(BOM_ACCOUNT_LIMIT, session.userId);
    if (accountRetryAfter !== null) {
      res.setHeader("Retry-After", accountRetryAfter);
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    const projectRetryAfter = consumeRateLimit(BOM_PROJECT_LIMIT, String(projectId));
    if (projectRetryAfter !== null) {
      res.setHeader("Retry-After", projectRetryAfter);
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }

    const key = process.env.HACKCLUB_CDN_KEY;
    if (!key) {
      console.error("[uploads] HACKCLUB_CDN_KEY is not set, refusing upload");
      return res.status(503).json({ ok: false, error: "cdn_not_configured" });
    }

    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].trim();
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || buf.length === 0) {
      if (contentType && !CSV_TYPES.includes(contentType))
        return res.status(415).json({ ok: false, error: "unsupported_type" });
      return res.status(400).json({ ok: false, error: "empty_body" });
    }
    const validation = validateBomCsv(buf);
    if (!validation.ok) return res.status(400).json({ ok: false, error: validation.error });
    const safeBuf = sanitizeBomCsv(buf);

    const quota = reserveCdnUploadQuota(CDN_UPLOAD_QUOTA, session.userId, safeBuf.length);
    if (!quota.ok) {
      res.setHeader("Retry-After", quota.retryAfterSeconds);
      return res.status(429).json({ ok: false, error: "quota_exceeded" });
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(safeBuf)], { type: "text/csv" }), `bom-${Date.now()}.csv`);

    try {
      const r = await fetch("https://cdn.hackclub.com/api/v4/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!r.ok) {
        console.error("[uploads] bom cdn rejected", r.status, await r.text());
        releaseCdnUploadQuota(CDN_UPLOAD_QUOTA, session.userId, safeBuf.length);
        return res.status(502).json({ ok: false, error: "cdn_failed" });
      }
      const json = (await r.json()) as { url?: string };
      if (!json.url) {
        console.error("[uploads] bom cdn response missing url", json);
        releaseCdnUploadQuota(CDN_UPLOAD_QUOTA, session.userId, safeBuf.length);
        return res.status(502).json({ ok: false, error: "cdn_failed" });
      }
      const { error: updateError } = await supabase
        .from("projects")
        .update({ bom_url: json.url })
        .eq("id", projectId)
        .eq("user_id", session.userId);
      if (updateError) {
        console.error("[uploads] bom project update failed", updateError);
        return res.status(500).json({ ok: false });
      }
      res.json({ ok: true, url: json.url });
    } catch (e) {
      console.error("[uploads] bom upload failed", e);
      releaseCdnUploadQuota(CDN_UPLOAD_QUOTA, session.userId, safeBuf.length);
      res.status(502).json({ ok: false, error: "cdn_failed" });
    }
  },
);

export default router;
