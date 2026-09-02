// Docs knowledge for pixo. The docs and the landing FAQ live on the web
// (pixl.hackclub.com), not in this repo, pixo fetches them on demand and
// caches the extracted text in memory so answering a question the second time
// is instant. This text is ONLY ever passed to the dedicated "answer from docs"
// model call (see answerFromDocs.ts); it is never added to the main chat system
// prompt, which would blow up the input token cost on every message.

import axios from "axios";

// Where the docs and FAQ live. Overridable per environment.
const DOCS_URL = (process.env.PIXL_DOCS_URL ?? "https://pixl.hackclub.com/docs").replace(/\/+$/, "");
const LANDING_URL = (process.env.PIXL_LANDING_URL ?? "https://pixl.hackclub.com").replace(/\/+$/, "");
// The docs index (/docs/) is just a redirect stub; the welcome page carries the
// full sidebar with links to every doc page, so that's our discovery seed.
const DOCS_SEED = DOCS_URL + "/welcome/";

// Re-fetch at most this often. Docs change rarely; a few hours is plenty.
const TTL_MS = 6 * 60 * 60 * 1000;
// Safety caps so the corpus (and the answer-call token cost) stays bounded.
const MAX_PAGES = 20;
const MAX_CORPUS_CHARS = 18000;
const PER_PAGE_CHARS = 1400;

let cache: { corpus: string; fetchedAt: number } | null = null;
let inFlight: Promise<string> | null = null;

/** Strip an HTML document down to readable text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&") // decoded LAST so "&amp;lt;" -> "&lt;", not "<"
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Just the page's article body, dropping the repeated sidebar nav/chrome. */
function mainContent(html: string): string {
  const m =
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  return m ? m[1] : html;
}

async function fetchText(url: string): Promise<string> {
  const res = await axios.get(url, {
    timeout: 8000,
    responseType: "text",
    headers: { "User-Agent": "pixorpheus-docs/1.0" },
    maxContentLength: 3_000_000,
  });
  return typeof res.data === "string" ? res.data : String(res.data ?? "");
}

/** Same-origin /docs/* page links from an HTML doc (skips assets like .css). */
function docPageLinks(html: string): string[] {
  const origin = new URL(DOCS_URL).origin;
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#?]+)["']/gi)) {
    let href = m[1];
    if (href.startsWith(origin)) href = href.slice(origin.length);
    if (!href.startsWith("/docs")) continue;
    const lastSeg = href.replace(/\/+$/, "").split("/").pop() || "";
    if (lastSeg.includes(".")) continue; // .css/.js/etc, not a doc page
    out.add(origin + href.replace(/\/+$/, "") + "/");
  }
  return [...out].slice(0, MAX_PAGES);
}

/** Undo the JSON/unicode escaping the FAQ text carries inside the RSC payload. */
function unescapeJson(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, "&")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The landing renders the FAQ from a dictionary that Next serializes into the
 * page's RSC payload as JSON: {"question":"…","answer":"…"}. The visible DOM
 * only carries the questions (answers expand client-side), so we pull the
 * question/answer pairs straight out of that payload instead.
 */
function extractFaqPairs(rawHtml: string): string {
  const out: string[] = [];
  const re = /\\"question\\":\\"((?:[^\\]|\\.)*?)\\",\\"answer\\":\\"((?:[^\\]|\\.)*?)\\"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawHtml)) && out.length < 20) {
    const q = unescapeJson(m[1]);
    const a = unescapeJson(m[2]);
    if (q && a) out.push(`Q: ${q}\nA: ${a}`);
  }
  return out.join("\n\n");
}

async function buildCorpus(): Promise<string> {
  const chunks: string[] = [];
  const seen = new Set<string>();

  // 1. Landing FAQ first (its own Q/A pairs) so it's never crowded out by the
  //    docs pages, which fill the rest of the budget.
  try {
    const faq = extractFaqPairs(await fetchText(LANDING_URL));
    if (faq) chunks.push(`# Pixl FAQ (from the landing)\n${faq}`);
  } catch {
    /* landing unreachable, docs cover the FAQ topics anyway */
  }

  // 2. Docs: seed from the welcome page (real content + full sidebar), then
  //    fetch every page it links to.
  try {
    const seedHtml = await fetchText(DOCS_SEED);
    seen.add(DOCS_SEED);
    const seedText = htmlToText(mainContent(seedHtml)).slice(0, PER_PAGE_CHARS);
    if (seedText.length > 40) chunks.push(`# ${DOCS_SEED}\n${seedText}`);

    for (const url of docPageLinks(seedHtml)) {
      if (seen.has(url)) continue;
      seen.add(url);
      if (chunks.join("\n").length > MAX_CORPUS_CHARS) break;
      try {
        const text = htmlToText(mainContent(await fetchText(url))).slice(0, PER_PAGE_CHARS);
        if (text.length > 40) chunks.push(`# ${url}\n${text}`);
      } catch {
        /* skip a page that fails */
      }
    }
  } catch {
    /* docs unreachable */
  }

  return chunks.join("\n\n").slice(0, MAX_CORPUS_CHARS);
}

/**
 * The cached docs+FAQ text. Fetched on first use and refreshed after TTL.
 * Concurrent callers share one in-flight fetch. Returns "" if everything was
 * unreachable (callers treat that as "no docs available").
 */
export async function getDocsCorpus(): Promise<string> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.corpus;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const corpus = await buildCorpus();
      if (corpus) cache = { corpus, fetchedAt: Date.now() };
      return corpus || cache?.corpus || "";
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** For ops/debugging: the doc URLs pixo pulls from. */
export const DOCS_LINKS = { docs: DOCS_URL, landing: LANDING_URL };
