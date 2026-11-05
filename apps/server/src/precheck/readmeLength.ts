import { findReadme, parseGithubRepo, type RepoRef } from "./rules.js";
import { fetchRawFile, fetchRepoFiles } from "./sources.js";

// A small, deterministic gate before ship. The AI pre-check still handles
// content and quality after ship; length alone is not a quality verdict.
export const MIN_README_CHARS = 200;

export type ReadmeLengthStatus = "passed" | "too_short" | "missing" | "unavailable" | "unsupported";
export interface ReadmeLengthResult {
  status: ReadmeLengthStatus;
  chars: number | null;
  minChars: number;
}

type ReadmeSources = {
  files?: (ref: RepoRef) => Promise<string[] | null>;
  raw?: (ref: RepoRef, file: string) => Promise<string | null>;
};

// Count the explanatory text, not badges, URLs, Markdown syntax or code dumps.
// Unicode letters/numbers count, so non-English READMEs work as well.
export function readmeProseLength(markdown: string): number {
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
  return [...prose].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
}

export async function checkReadmeLength(repoUrl: string, sources: ReadmeSources = {}): Promise<ReadmeLengthResult> {
  const unknown = (status: ReadmeLengthStatus): ReadmeLengthResult => ({
    status,
    chars: null,
    minChars: MIN_README_CHARS,
  });
  const ref = parseGithubRepo(repoUrl);
  // Do not fetch arbitrary git hosts here: their README endpoints vary and
  // following arbitrary URLs risks SSRF. Those hosts remain reviewable.
  if (!ref) return unknown("unsupported");
  const files = await (sources.files ?? fetchRepoFiles)(ref);
  if (!files) return unknown("unavailable");
  const name = findReadme(files);
  if (!name) return { status: "missing", chars: 0, minChars: MIN_README_CHARS };
  const readme = await (sources.raw ?? fetchRawFile)(ref, name);
  if (readme === null) return unknown("unavailable");
  const chars = readmeProseLength(readme);
  return {
    status: chars >= MIN_README_CHARS ? "passed" : "too_short",
    chars,
    minChars: MIN_README_CHARS,
  };
}
