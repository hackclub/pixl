import { describe, expect, test } from "bun:test";
import { getAllSlugs, getDoc, getFirstSlug, getNav } from "./docs.ts";

describe("getAllSlugs", () => {
  test("returns every doc slug, ordered by filename prefix", async () => {
    const slugs = await getAllSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(slugs[0]).toBe("welcome");
  });
});

describe("getFirstSlug", () => {
  test("matches the first entry from getAllSlugs", async () => {
    const [first, all] = await Promise.all([getFirstSlug(), getAllSlugs()]);
    expect(first).toBe(all[0]);
  });
});

describe("getNav", () => {
  test("one nav item per doc, grouped by frontmatter group", async () => {
    const nav = await getNav();
    const welcome = nav.find((n) => n.slug === "welcome");
    expect(welcome?.group).toBe("Start here");
    expect(welcome?.title).toBe("Welcome to Pixl");
  });
});

describe("getDoc", () => {
  test("returns null for an unknown slug", async () => {
    expect(await getDoc("does-not-exist")).toBeNull();
  });

  test("returns the doc plus its prev/next nav neighbors", async () => {
    const slugs = await getAllSlugs();
    const entry = await getDoc(slugs[1]!);
    expect(entry).not.toBeNull();
    expect(entry!.doc.slug).toBe(slugs[1]);
    expect(entry!.prev?.slug).toBe(slugs[0]);
  });

  test("the first doc has no prev", async () => {
    const first = await getFirstSlug();
    const entry = await getDoc(first);
    expect(entry!.prev).toBeNull();
  });

  test("substitutes {{token}} placeholders in the body", async () => {
    // pick a doc that actually references economy tokens
    const entry = await getDoc("rules");
    expect(entry).not.toBeNull();
    expect(entry!.doc.body).not.toMatch(/\{\{/);
  });
});
