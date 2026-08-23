// Reads docs/*.md straight off the filesystem — no client router existed to
// route between static pages before, so this is the only place that
// content now gets loaded. docs/ lives three levels up from this file (repo
// root), the same relative position in dev (`bun run --cwd apps/web-shell
// dev`), in the Docker image (see ../Dockerfile, which preserves the
// repo-root-relative layout on purpose), and under `bun test` run from the
// repo root. Resolved off import.meta.url rather than process.cwd() so it
// doesn't depend on the invoking process's working directory. Neither
// Bun's import.meta.dir nor import.meta.dirname is used here: `next
// build`'s page-data collection executes this module under Node, not Bun,
// even though the build itself is launched via `bun run`, and Turbopack's
// import.meta.dirname transform for that pass evaluates to undefined
// (it only wires up a `url` getter), throwing inside path.join. Deriving
// the directory from import.meta.url via fileURLToPath is the one form
// that resolves correctly in Bun, plain Node, and under Turbopack.
import { cache } from "react";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, type Doc } from "@pixl/docs-engine/src/markdown.ts";
import { buildTokens } from "@pixl/docs-engine/src/tokens.ts";
import { config } from "@/app/_generated/config";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(HERE, "..", "..", "..", "docs");
// `config` is generated with `as const` (deeply readonly); buildTokens's
// PixlConfig wants mutable arrays. The values are only ever read here.
const tokens = buildTokens(config as unknown as Parameters<typeof buildTokens>[0]);

export interface NavItem {
  slug: string;
  title: string;
  group: string;
}

async function loadAll(): Promise<{ docs: Doc[]; nav: NavItem[] }> {
  const files = (await readdir(DOCS_DIR)).filter((f) => f.endsWith(".md")).sort();
  const docs: Doc[] = [];
  for (const file of files) {
    const slug = file.replace(/^\d+-/, "").replace(/\.md$/, "");
    const src = await readFile(path.join(DOCS_DIR, file), "utf8");
    docs.push({ ...render(src, tokens), slug });
  }
  const nav: NavItem[] = docs.map((d) => ({ slug: d.slug, title: d.meta.title, group: d.meta.group }));
  return { docs, nav };
}

export async function getAllSlugs(): Promise<string[]> {
  const { docs } = await loadAll();
  return docs.map((d) => d.slug);
}

export async function getFirstSlug(): Promise<string> {
  const { docs } = await loadAll();
  return docs[0]!.slug;
}

export const getNav = cache(async function getNav(): Promise<NavItem[]> {
  const { nav } = await loadAll();
  return nav;
});

export async function getDoc(
  slug: string,
): Promise<{ doc: Doc; prev: NavItem | null; next: NavItem | null } | null> {
  const { docs, nav } = await loadAll();
  const i = docs.findIndex((d) => d.slug === slug);
  if (i === -1) return null;
  return { doc: docs[i]!, prev: nav[i - 1] ?? null, next: nav[i + 1] ?? null };
}

// Wrapped in React's cache() so a single request/render pass (the [slug]
// layout and page.tsx both calling getDoc(slug)) only reads the file off
// disk once, instead of once per caller.
export const cachedGetDoc = cache(getDoc);
