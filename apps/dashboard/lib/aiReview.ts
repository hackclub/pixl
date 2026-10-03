import type { CommitResult } from "./commits";
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
  deflationReason: string;
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
  // The hours currently typed into the review form, i.e. what the reviewer
  // has already decided to credit - equal to claimedHours until they lower
  // it themselves. The draft never picks this number, it only explains it
  // when it's already below claimedHours (see buildPrompt below).
  reviewerHours: number;
  commits: CommitResult;
  journals: JournalRow[];
  hackatime: HackatimeReport | null;
  trust: TrustFactor | null;
  yswsMatches: YswsShip[];
  // Real technicalFeatures/notes/deflationReason text from recently, fully
  // approved projects (see recentApprovedJustifications in lib/db.ts) - the
  // house style the draft should match, not a generic AI voice. Most recent
  // first.
  styleExamples: { technicalFeatures: string; notes: string; deflationReason: string }[];
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

  // Real reviewers' own text, verbatim, from projects that were actually
  // approved - capped per field (generously, real entries run 1000+ chars)
  // so a handful of examples can't dominate the prompt over the actual
  // project facts above/below.
  const styleBlock = input.styleExamples
    .slice(0, 5)
    .map((ex, i) => {
      const parts = [
        `TECHNICAL FEATURES:\n${ex.technicalFeatures.slice(0, 1500) || "(none written)"}`,
        `NOTES:\n${ex.notes.slice(0, 1500) || "(none written)"}`,
      ];
      if (ex.deflationReason) parts.push(`DEFLATION REASON:\n${ex.deflationReason.slice(0, 500)}`);
      return `Example ${i + 1}:\n${parts.join("\n\n")}`;
    })
    .join("\n\n");

  const styleSection = styleBlock
    ? `HOUSE STYLE - real reviewers' own text from recently APPROVED projects, verbatim. This is exactly what you're drafting, not inspiration - match the tone, length, and structure: a running paragraph (not bullet points) that opens with what the project actually is and its history (e.g. a prior YSWS submission), then walks through specific, verifiable technical details - cite commit SHAs when a specific commit is the evidence for a claim - then closes with an assessment of the README and demo. Terse and concrete throughout, no filler, no generic praise, no restating the obvious, no "this is a great project" style commentary. Write like these, not like a generic AI assistant.\n\n${styleBlock}\n\n`
    : "";

  const deflated = input.reviewerHours < input.claimedHours;
  const deflationInstruction = deflated
    ? `The reviewer has already decided to credit ${input.reviewerHours}h instead of the ${input.claimedHours}h claimed - draft the explanation for THAT decision (don't propose a different number). Ground it in the facts above: cross-YSWS overlap hours (if any match above), a claimed/tracked-time mismatch, or scope not matching the claim. Show the arithmetic the way a reviewer would ("X h already credited elsewhere + Yh deflated for Z reason = ${input.reviewerHours}h"), when the numbers support it.`
    : `The reviewer has not lowered the hours (crediting the full ${input.claimedHours}h claimed) - return "" for deflationReason.`;

  return `You are assisting a human reviewer on Pixl, a Hack Club program where teens ship real software/hardware projects for rewards. Draft review notes for them to read and edit - you are NOT deciding the verdict, tier, or credited hours, only helping them look faster. Never state a fact you can't point to in the data below; if something can't be verified from it, say so instead of guessing (e.g. don't invent an account age, repo count, or skill-level claim that isn't supported by the commits/README/journals here).

${styleSection}PROJECT
Name: ${input.projectName}
Kind: ${input.kind}
Description: ${input.description || "(none given)"}
Repo: ${input.repoUrl || "(none)"}
Demo: ${input.demoUrl || "(none)"}
Claimed hours: ${input.claimedHours}
Reviewer is currently crediting: ${input.reviewerHours}h
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
  "summary": "one sentence on what this project actually is/does, for a quick-glance preview",
  "technicalFeatures": "the full technical-features writeup - a running paragraph covering what the project is, its history (prior YSWS submissions/overlap if any), the concrete technical work done (cite commit SHAs for specific claims), and an assessment of the README and demo${styleBlock ? ", in the exact voice of the TECHNICAL FEATURES examples above" : ""}. Do not use markdown formatting.",
  "deflationReason": "${deflationInstruction}",
  "notes": "anything else worth flagging - commit legitimacy (explain any unusually large commit rather than just flagging it), whether commit messages/structure are consistent with the tracked time and with the AI-usage disclosure above, beginner-vs-experienced signals you can actually see in the code/commits${styleBlock ? ", in the exact voice of the NOTES examples above" : ""}. Do not use markdown formatting.",
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
      // The house-style paragraphs this now drafts commonly run 1000+
      // characters each across technicalFeatures/notes/deflationReason - the
      // provider's default max_tokens was truncating the JSON mid-string.
      max_tokens: 2000,
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
    deflationReason: String(parsed.deflationReason ?? ""),
    notes: String(parsed.notes ?? ""),
    redFlags: Array.isArray(parsed.redFlags) ? parsed.redFlags.map(String) : [],
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String) : [],
    model: MODEL,
  };
}
