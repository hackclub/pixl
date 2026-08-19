// "Answer from the docs" pipeline. Given a question:
//   1. check the answered-questions cache (pixo_qa_cache) — an exact or very
//      similar past question is answered instantly, no docs fetch, no model call
//   2. otherwise fetch the (cached) docs corpus and ask the model to answer
//      using ONLY the docs; if the docs don't cover it, we return null
//   3. a fresh answer is stored so the next similar question is a cache hit
//
// The docs text only ever enters this dedicated call — never the main chat
// system prompt — so ordinary messages don't pay the doc token cost.

import { aiPost } from "./client.js";
import { getDocsCorpus } from "./docs.js";
import { db } from "../db/client.js";

export interface DocsAnswer {
  answer: string;
  source: "cache" | "docs";
}

const NO_ANSWER = "NO_ANSWER";

function normalize(q: string): string {
  return q
    .toLowerCase()
    .replace(/<@[a-z0-9]+>/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(norm: string): Set<string> {
  return new Set(norm.split(" ").filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Small in-memory mirror of the cache rows, refreshed periodically, so a lookup
// doesn't hit the DB on every question.
let rowCache: { rows: { question_norm: string; answer: string }[]; at: number } | null = null;
const ROWS_TTL_MS = 60 * 1000;

async function cacheRows(): Promise<{ question_norm: string; answer: string }[]> {
  if (rowCache && Date.now() - rowCache.at < ROWS_TTL_MS) return rowCache.rows;
  try {
    const { data } = await db()
      .from("pixo_qa_cache")
      .select("question_norm, answer")
      .order("created_at", { ascending: false })
      .limit(300);
    rowCache = { rows: (data as any) || [], at: Date.now() };
  } catch {
    rowCache = { rows: [], at: Date.now() };
  }
  return rowCache.rows;
}

/** Exact-normalized or high token-overlap match against past answers. */
async function findCached(norm: string): Promise<string | null> {
  const rows = await cacheRows();
  if (!rows.length) return null;
  const exact = rows.find((r) => r.question_norm === norm);
  if (exact) return exact.answer;
  const qt = tokens(norm);
  let best: { answer: string; score: number } | null = null;
  for (const r of rows) {
    const score = jaccard(qt, tokens(r.question_norm));
    if (score > (best?.score ?? 0)) best = { answer: r.answer, score };
  }
  return best && best.score >= 0.8 ? best.answer : null;
}

async function storeAnswer(question: string, norm: string, answer: string): Promise<void> {
  try {
    await db()
      .from("pixo_qa_cache")
      .upsert({ question, question_norm: norm, answer, source: "docs" }, { onConflict: "question_norm", ignoreDuplicates: true });
    rowCache = null; // invalidate so the new answer is matchable right away
  } catch {
    /* best-effort cache write */
  }
}

/**
 * Answer a question from the docs, or return null if the docs don't cover it
 * (the signal to fall back to a human helper).
 */
export async function answerQuestion(rawQuestion: string): Promise<DocsAnswer | null> {
  const question = (rawQuestion || "").trim();
  if (question.length < 8) return null;
  const norm = normalize(question);
  if (!norm) return null;

  const cached = await findCached(norm);
  if (cached) return { answer: cached, source: "cache" };

  const corpus = await getDocsCorpus();
  if (!corpus) return null;

  let content = "";
  try {
    const res = await aiPost({
      messages: [
        {
          role: "system",
          content:
            "You are pixo, the Pixl help bot. Answer the user's question using ONLY the Pixl docs provided below. " +
            "Be concise, friendly and clear (casual lowercase is fine, no markdown headers, 1-4 sentences). " +
            `If the docs do not contain the answer, reply with exactly ${NO_ANSWER} and nothing else. ` +
            "If the question is something simple that is not in the docs due to it being too simple/too generalised, you may use this to answer too." +
            "Never invent facts that aren't in the docs.\n\n=== PIXL DOCS ===\n" +
            corpus,
        },
        { role: "user", content: question },
      ],
      max_tokens: 220,
    });
    content = (res.data.choices?.[0]?.message?.content || "").trim();
  } catch {
    return null;
  }

  if (!content || content.toUpperCase().includes(NO_ANSWER)) return null;

  await storeAnswer(question, norm, content);
  return { answer: content, source: "docs" };
}
