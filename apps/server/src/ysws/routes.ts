import { Router } from "express";
import { db } from "../db/client.js";
import { addNotification } from "../routes/notifications.js";
import { yswsShipForSlackId, yswsShipsForSlackId } from "./archive.js";
import { availableShips, collectTaken, nameFromShip } from "./imports.js";
import { parseProjectBody, toPlayerProject } from "../routes/projects.js";
import { allowedImageUrl } from "../http/imageUrls.js";
import { projectCreationClosed } from "../submissionDeadline.js";
import { z } from "zod";
import { validate, v } from "../http/validate.js";

const router = Router();

function cleanSlackId(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? "" : s;
}

router.get("/api/projects/ysws-available", async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  const { data: userRow } = await db
    .from("users")
    .select("slack_id")
    .eq("id", session.userId)
    .maybeSingle();
  const slackId = cleanSlackId((userRow as { slack_id?: string } | null)?.slack_id);
  if (!slackId) return res.json({ ok: true, ships: [] });

  const ships = await yswsShipsForSlackId(slackId);
  if (ships.length === 0) return res.json({ ok: true, ships: [] });

  const { data: mine, error: mineError } = await db
    .from("projects")
    .select("repo_url, demo_url, imported_ysws_entry_id")
    .eq("user_id", session.userId);
  if (mineError) {
    console.error("[ysws] import listing needs migration 0089", mineError);
    return res.json({ ok: true, ships: [] });
  }

  const taken = collectTaken(
    (mine ?? []) as {
      imported_ysws_entry_id?: string | null;
      repo_url?: string | null;
      demo_url?: string | null;
    }[],
  );
  const available = availableShips(ships, taken);

  res.json({
    ok: true,
    ships: available.map((s) => ({
      id: s.id,
      ysws: s.ysws,
      hours: s.hours,
      approvedAt: s.approvedAt,
      codeUrl: s.codeUrl,
      demoUrl: s.demoUrl,
      description: s.description.slice(0, 300),
      name: nameFromShip(s.codeUrl, s.demoUrl, s.ysws),
    })),
  });
});

router.post("/api/projects/import-ysws", validate({ query: v.noQuery, body: z.object({ entryId: z.union([z.string().max(200), z.number()]) }) }), async (req, res) => {
  const session = req.session;
  if (!session) return res.status(401).json({ ok: false });

  if (projectCreationClosed()) return res.status(403).json({ ok: false, error: "project_creation_closed" });
  const entryId = String(req.body?.entryId ?? "").trim();
  if (entryId === "") return res.status(400).json({ ok: false, error: "entry_required" });

  const { data: userRow } = await db
    .from("users")
    .select("slack_id")
    .eq("id", session.userId)
    .maybeSingle();
  const slackId = cleanSlackId((userRow as { slack_id?: string } | null)?.slack_id);
  if (!slackId) return res.status(400).json({ ok: false, error: "no_slack_link" });

  const ship = await yswsShipForSlackId(slackId, entryId);
  if (!ship) return res.status(404).json({ ok: false, error: "ship_not_found" });

  const { data: dupe } = await db
    .from("projects")
    .select("id")
    .eq("user_id", session.userId)
    .eq("imported_ysws_entry_id", ship.id)
    .maybeSingle();
  if (dupe) return res.status(409).json({ ok: false, error: "already_imported" });

  const parsed = parseProjectBody({
    name: nameFromShip(ship.codeUrl, ship.demoUrl, ship.ysws),
    description: ship.description,
    repoUrl: ship.codeUrl,
    demoUrl: ship.demoUrl,
    // A screenshot hosted anywhere but the Hack Club CDN is dropped, not
    // carried over (http/imageUrls.ts); the player can upload one.
    imageUrl: allowedImageUrl(ship.screenshotUrl) ?? "",
  });
  if (parsed.error !== undefined)
    return res.status(400).json({ ok: false, error: parsed.error });

  const { data, error } = await db
    .from("projects")
    .insert({
      user_id: session.userId,
      ...parsed.fields,
      imported_ysws_entry_id: ship.id,
      imported_from_ysws: ship.ysws,
      imported_ysws_hours: ship.hours,
      imported_ysws_approved_at: ship.approvedAt
        ? new Date(ship.approvedAt * 1000).toISOString()
        : null,
    })
    .select()
    .single();
  if (error) {
    console.error("[ysws] import failed", error);
    return res.status(500).json({ ok: false });
  }
  void addNotification(
    session.userId,
    "Project imported",
    `"${parsed.fields.name}" came in from ${ship.ysws}. Its ${ship.hours}h there don't carry over, only new tracked work counts here.`,
  );
  res.json({ ok: true, project: toPlayerProject(data, session.userId) });
});

export default router;