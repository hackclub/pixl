import { NextResponse } from "next/server";
import { guardedRoute, can } from "@/lib/guard";
import { firstPassAccess, globalSearch } from "@/lib/db";
import { canReadReviewEvidence } from "@/lib/reviewAccess";
import { slackHandles } from "@/lib/slack";

export const dynamic = "force-dynamic";

export const GET = guardedRoute("api.search", "staff", async (access, req) => {

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ players: [], projects: [] });

  const canPlayers = can(access, "owner");
  const canProjects = can(access, "reviewer");

  const { players, projects } = await globalSearch(q, {
    players: canPlayers,
    projects: canProjects,
  });

  // Search must not reveal projects the review page would hide, including
  // other queues, fraud/second pass and the restricted first-pass queue.
  const visibility = await Promise.all(projects.map(async (p) => {
    if (!canReadReviewEvidence(access, p)) return false;
    if (p.status !== "shipped" || access.canOpenFullQueue) return true;
    return (await firstPassAccess(p.id, access.session.slackId, false)).ok;
  }));
  const allowedProjects = projects.filter((_p, i) => visibility[i]);
  const handles = await slackHandles(players.map((p) => p.slack_id));

  return NextResponse.json({
    players: players.map((p) => ({
      id: p.id,
      label: (p.real_name || (p.slack_id && handles.get(p.slack_id)) || p.slack_id || p.display_name) ?? "",
      sub: p.display_name,
    })),
    // Project names repeat a lot ("My Portfolio"), so say whose each one is.
    projects: allowedProjects.map((p) => {
      const maker = p.users?.display_name;
      return {
        id: p.id,
        label: p.name,
        sub: maker ? `by ${maker} · #${p.id}` : `#${p.id}`,
        status: p.status,
      };
    }),
  });
});
