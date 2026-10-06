import { NextResponse } from "next/server";
import { getAccess, canView } from "@/lib/guard";
import { globalSearch } from "@/lib/db";
import { slackHandles } from "@/lib/slack";
import { getLiveMode } from "@/lib/liveModeServer";
import { liveName } from "@/lib/liveMode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const access = await getAccess();
  if (!access) return NextResponse.json({ players: [], projects: [] }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ players: [], projects: [] });

  const canPlayers = canView(access, ["warn", "ban"]);
  const canProjects = canView(access, ["review", "warn", "ban"]);

  const { players, projects } = await globalSearch(q, {
    players: canPlayers,
    projects: canProjects,
  });

  const live = await getLiveMode();
  const handles = await slackHandles(players.map((p) => p.slack_id));

  return NextResponse.json({
    players: players.map((p) => ({
      id: p.id,
      label: liveName(live, p, p.real_name || (p.slack_id && handles.get(p.slack_id)) || p.slack_id || p.display_name),
      sub: p.display_name,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      label: p.name,
      status: p.status,
    })),
  });
}
