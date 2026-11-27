import { findReadme, parseGithubRepo, type RepoRef } from "./rules.js";
import { fetchRawFile, fetchRepoFiles } from "./sources.js";

// A small, deterministic gate before ship. The AI pre-check still handles
// content and quality after ship; length alone is not a quality verdict.
export const MIN_README_WORDS = 100;

export type ReadmeLengthStatus = "passed" | "too_short" | "missing" | "unavailable" | "unsupported";
export interface ReadmeLengthResult {
  status: ReadmeLengthStatus;
  words: number | null;
  minWords: number;
}

type ReadmeSources = {
  files?: (ref: RepoRef) => Promise<string[] | null>;
  raw?: (ref: RepoRef, file: string) => Promise<string | null>;
};

// Count prose words, not badges, URLs, Markdown syntax or code dumps.
// Segment words by language-aware boundaries so non-English text counts too.
export function readmeProseWordCount(markdown: string): number {
  const prose = markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/\s*(?:script|style)\s*>/gi, " ")
    .replace(/(?:\x60\x60\x60|~~~)[\s\S]*?(?:\x60\x60\x60|~~~)/g, " ")
    .replace(/^(?: {4}|\t).+$/gm, " ")
    .replace(/\x60[^\x60]*\x60/g, " ")
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_~>|{}\[\]\\]/g, " ");
  return [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(prose)]
    .filter(({ segment, isWordLike }) => isWordLike && /[\p{L}]/u.test(segment)).length;
}

export async function checkReadmeLength(repoUrl: string, sources: ReadmeSources = {}): Promise<ReadmeLengthResult> {
  const unknown = (status: ReadmeLengthStatus): ReadmeLengthResult => ({
    status,
    words: null,
    minWords: MIN_README_WORDS,
  });
  const ref = parseGithubRepo(repoUrl);
  // Do not fetch arbitrary git hosts here: their README endpoints vary and
  // following arbitrary URLs risks SSRF. Those hosts remain reviewable.
  if (!ref) return unknown("unsupported");
  const files = await (sources.files ?? fetchRepoFiles)(ref);
  if (!files) return unknown("unavailable");
  const name = findReadme(files);
  if (!name) return { status: "missing", words: 0, minWords: MIN_README_WORDS };
  const readme = await (sources.raw ?? fetchRawFile)(ref, name);
  if (readme === null) return unknown("unavailable");
  const words = readmeProseWordCount(readme);
  return {
    status: words >= MIN_README_WORDS ? "passed" : "too_short",
    words,
    minWords: MIN_README_WORDS,
  };
}
