import type { CommitResult } from "./github";
import type { JournalRow } from "./db";
import type { HackatimeReport, TrustFactor } from "./hackatime";
import type { YswsShip } from "./ysws";

// AI-drafted review notes, to assist (never replace) a human reviewer. The
// model reads the same objective facts a reviewer already has open on the
// page (commits, journals, Hackatime numbers, trust factor, cross-YSWS
// duplicate check) and drafts the audit-note text a reviewer would otherwise
// type by hand - it never proposes a verdict or credited hours, and nothing
// here is submitted automatically. See apps/pixorpheus/src/ai/client.ts for
// the same OpenRouter call pattern used elsewhere in this monorepo.

const MODEL = process.env.AI_REVIEW_MODEL || "anthropic/claude-sonnet-4.5";

export interface AiReviewDraft {
  summary: string;
  technicalFeatures: string;
  hackatimeEvidence: string;
  notes: string;
  redFlags: string[];
  strengths: string[];
  model: string;
}

export interface AiReviewInput {
  projectName: string;
  description: string;
  repoUrl: string | null;
  demoUrl: string | null;
  kind: string;
  aiNotes: string;
  claimedHours: number;
  commits: CommitResult;
  journals: JournalRow[];
  hackatime: HackatimeReport | null;
  trust: TrustFactor | null;
  yswsMatches: YswsShip[];
}

// Best-effort README fetch, single call, never blocks the draft on failure -
// the model can still work from commit messages/journals alone without it.
async function fetchReadme(repoUrl: string | null): Promise<string> {
  if (!repoUrl) return "";
  try {
    const u = new URL(repoUrl);
    if (u.hostname !== "github.com") return "";
    const [, owner, repo] = u.pathname.split("/");
    if (!owner || !repo) return "";
    const headers: Record<string, string> = { Accept: "application/vnd.github.raw+json" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const r = await fetch(
      `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}/readme`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return "";
    const text = await r.text();
    return text.slice(0, 8000);
  } catch {
    return "";
  }
}

function buildPrompt(input: AiReviewInput, readme: string): string {
  const commitLines = input.commits.commits
    .slice(0, 30)
    .map(
      (c) =>
        `- ${c.sha} "${c.message}" by ${c.author}${c.additions != null ? ` (+${c.additions}/-${c.deletions})` : ""}${c.ai ? " [AI-flagged]" : ""}${c.tracked != null ? ` [~${Math.round(c.tracked / 60)}min tracked]` : ""}`,
    )
    .join("\n");

  const journalLines = input.journals
    .map((j) => `- ${j.hours}h${j.approved_hours != null ? ` (credited: ${j.approved_hours}h)` : ""}: ${(j.content ?? "").slice(0, 400)}`)
    .join("\n");

  const hackatimeLines = (input.hackatime?.projects ?? [])
    .filter((p) => p.linked)
    .map((p) => `- ${p.name}: ${p.text} (${p.sessions} sessions)`)
    .join("\n");

  const yswsLines = input.yswsMatches
    .map((s) => `- ${s.ysws}, ${s.hours}h${s.approvedAt ? `, approved ${s.approvedAt.slice(0, 10)}` : ""}: ${s.description}`)
    .join("\n");

  return `You are assisting a human reviewer on Pixl, a Hack Club program where teens ship real software/hardware projects for rewards. Draft review notes for them to read and edit - you are NOT deciding the verdict, tier, or credited hours, only helping them look faster.

PROJECT
Name: ${input.projectName}
Kind: ${input.kind}
Description: ${input.description || "(none given)"}
Repo: ${input.repoUrl || "(none)"}
Demo: ${input.demoUrl || "(none)"}
Claimed hours: ${input.claimedHours}
Maker's own AI-usage disclosure: ${input.aiNotes || "(nothing disclosed)"}

README (may be truncated):
${readme || "(could not fetch)"}

COMMITS (newest first, up to 30):
${commitLines || "(none found)"}

JOURNAL ENTRIES:
${journalLines || "(none)"}

HACKATIME (linked projects):
${hackatimeLines || "(no Hackatime data)"}
Hackatime trust factor: ${input.trust ? `${input.trust.level} (${input.trust.value})` : "(unavailable)"}

CROSS-YSWS ARCHIVE MATCHES (same repo/demo shipped elsewhere):
${yswsLines || "(no matches - not previously shipped elsewhere)"}

Respond with ONLY a JSON object, no markdown fences, matching exactly:
{
  "summary": "one or two sentences on what this project actually is/does",
  "technicalFeatures": "concrete technical features you can verify from the README/commits - specific, not generic",
  "hackatimeEvidence": "a sentence or two sanity-checking claimed hours against commits/journals/Hackatime data - note any mismatch",
  "notes": "anything else worth flagging - beginner signals, AI-disclosure consistency, etc",
  "redFlags": ["short phrase per concern - thin commit history, hour mismatch, etc - empty array if none"],
  "strengths": ["short phrase per notable strength - empty array if none"]
}`;
}

export async function generateAiReviewDraft(input: AiReviewInput): Promise<AiReviewDraft> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const readme = await fetchReadme(input.repoUrl);
  const prompt = buildPrompt(input, readme);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  let parsed: Partial<AiReviewDraft>;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI response wasn't valid JSON");
  }

  return {
    summary: String(parsed.summary ?? ""),
    technicalFeatures: String(parsed.technicalFeatures ?? ""),
    hackatimeEvidence: String(parsed.hackatimeEvidence ?? ""),
    notes: String(parsed.notes ?? ""),
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags.map(String) : [],
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    model: MODEL,
  };
}
