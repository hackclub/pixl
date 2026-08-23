import express, { Router } from "express";
import { verifySessionToken } from "../auth/session.js";
import { checkImageSafe, MAX_MODERATE_BYTES } from "../imageModeration.js";

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
    // or array — express.raw() only populates a Buffer for IMAGE_TYPES. Narrow
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

    const ext = type === "image/jpeg" ? "jpg" : (type.split("/")[1] ?? "png");
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buf)], { type }),
      `journal-${Date.now()}.${ext}`,
    );

    // Moderation and the CDN upload don't depend on each other, so run them
    // concurrently instead of back-to-back — halves the wait for the common case.
    const cdnUpload = fetch("https://cdn.hackclub.com/api/v4/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    })
      .then(async (r) => {
        if (!r.ok) {
          console.error("[uploads] cdn rejected", r.status, await r.text());
          return null;
        }
        const json = (await r.json()) as { url?: string };
        if (!json.url) console.error("[uploads] cdn response missing url", json);
        return json.url ?? null;
      })
      .catch((e) => {
        console.error("[uploads] cdn upload failed", e);
        return null;
      });

    const [safety, cdnUrl] = await Promise.all([checkImageSafe(buf, type), cdnUpload]);

    if (!safety.safe) {
      return res
        .status(400)
        .json({ ok: false, error: "image_rejected", reason: safety.reason });
    }
    if (!cdnUrl) return res.status(502).json({ ok: false, error: "cdn_failed" });
    res.json({ ok: true, url: cdnUrl });
  },
);

const CSV_TYPES = ["text/csv", "application/vnd.ms-excel", "application/csv"];
const MAX_CSV_BYTES = 2_000_000;

// A hardware ship's Bill of Materials — not an image, so no vision moderation,
// just a straight proxy to the CDN like the image route above.
router.post(
  "/api/uploads/bom",
  express.raw({ type: CSV_TYPES, limit: MAX_CSV_BYTES }),
  async (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const session = token ? verifySessionToken(token) : null;
    if (!session) return res.status(401).json({ ok: false });

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

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: "text/csv" }), `bom-${Date.now()}.csv`);

    try {
      const r = await fetch("https://cdn.hackclub.com/api/v4/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      if (!r.ok) {
        console.error("[uploads] bom cdn rejected", r.status, await r.text());
        return res.status(502).json({ ok: false, error: "cdn_failed" });
      }
      const json = (await r.json()) as { url?: string };
      if (!json.url) {
        console.error("[uploads] bom cdn response missing url", json);
        return res.status(502).json({ ok: false, error: "cdn_failed" });
      }
      res.json({ ok: true, url: json.url });
    } catch (e) {
      console.error("[uploads] bom upload failed", e);
      res.status(502).json({ ok: false, error: "cdn_failed" });
    }
  },
);

export default router;
