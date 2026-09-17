import { describe, expect, test } from "bun:test";
import {
  gitDiscoveryUrl,
  isGitRepoUrl,
  isKnownForgeHost,
  looksLikeGitAdvertisement,
  parseRepoUrl,
} from "./gitRepoUrl.js";

const allPublic = async () => true;

/** Minimal stand-in for a host answering (or not answering) git discovery. */
function fakeFetch(routes: Record<string, { status?: number; contentType?: string; body?: string; location?: string }>) {
  const calls: string[] = [];
  const impl = (async (url: string | URL) => {
    const key = String(url);
    calls.push(key);
    const r = routes[key];
    if (!r) return new Response("nope", { status: 404 });
    const headers: Record<string, string> = {};
    if (r.contentType) headers["content-type"] = r.contentType;
    if (r.location) headers["location"] = r.location;
    return new Response(r.body ?? "", { status: r.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ADVERT = "001e# service=git-upload-pack\n0000";

describe("parseRepoUrl", () => {
  test("rejects a non-http scheme", () => expect(parseRepoUrl("javascript:alert(1)")).toBeNull());
  test("rejects garbage", () => expect(parseRepoUrl("not a url")).toBeNull());
  test("rejects a bare origin", () => expect(parseRepoUrl("https://codeberg.org")).toBeNull());
  test("accepts a repo path", () => expect(parseRepoUrl("https://codeberg.org/a/b")?.hostname).toBe("codeberg.org"));
});

describe("isKnownForgeHost", () => {
  for (const h of ["github.com", "www.github.com", "GitHub.com", "codeberg.org", "gitlab.com", "git.sr.ht"]) {
    test(`knows ${h}`, () => expect(isKnownForgeHost(h)).toBe(true));
  }
  test("does not know a random host", () => expect(isKnownForgeHost("example.com")).toBe(false));
});

describe("gitDiscoveryUrl", () => {
  test("appends the discovery path", () =>
    expect(gitDiscoveryUrl(new URL("https://git.example.com/me/thing"))).toBe(
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
    ));
  test("tolerates a trailing slash", () =>
    expect(gitDiscoveryUrl(new URL("https://git.example.com/me/thing/"))).toBe(
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
    ));
  test("drops an existing query and fragment", () =>
    expect(gitDiscoveryUrl(new URL("https://git.example.com/me/thing?tab=x#readme"))).toBe(
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
    ));
});

describe("looksLikeGitAdvertisement", () => {
  test("smart http content type", () =>
    expect(looksLikeGitAdvertisement("application/x-git-upload-pack-advertisement", "")).toBe(true));
  test("smart http pkt-line body", () => expect(looksLikeGitAdvertisement("text/plain", ADVERT)).toBe(true));
  test("dumb http refs file", () =>
    expect(looksLikeGitAdvertisement("text/plain", "9f2c1a4b8e7d6c5b4a39281706f5e4d3c2b1a099\trefs/heads/main")).toBe(true));
  test("an html page is not a repo", () =>
    expect(looksLikeGitAdvertisement("text/html", "<!doctype html><html>")).toBe(false));
});

describe("isGitRepoUrl", () => {
  test("github still passes with no network call", async () => {
    const { impl, calls } = fakeFetch({});
    expect(await isGitRepoUrl("https://github.com/ridit/pixl", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(true);
    expect(calls).toEqual([]);
  });

  test("github user page without a repo is still rejected", async () => {
    const { impl } = fakeFetch({});
    expect(await isGitRepoUrl("https://github.com/ridit", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(false);
  });

  test("codeberg passes, the thing issue #28 was about", async () => {
    const { impl } = fakeFetch({});
    expect(await isGitRepoUrl("https://codeberg.org/brandt/thing", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(true);
  });

  test("a self-hosted forgejo answers discovery and passes", async () => {
    const { impl } = fakeFetch({
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack": {
        contentType: "application/x-git-upload-pack-advertisement",
        body: ADVERT,
      },
    });
    expect(await isGitRepoUrl("https://git.example.com/me/thing", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(true);
  });

  test("a dumb http host serving a refs file passes", async () => {
    const { impl } = fakeFetch({
      "https://cgit.example.com/thing.git/info/refs?service=git-upload-pack": {
        contentType: "text/plain",
        body: "9f2c1a4b8e7d6c5b4a39281706f5e4d3c2b1a099\trefs/heads/main\n",
      },
    });
    expect(await isGitRepoUrl("https://cgit.example.com/thing.git", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(true);
  });

  test("a plain website is rejected", async () => {
    const { impl } = fakeFetch({
      "https://example.com/blog/post/info/refs?service=git-upload-pack": {
        contentType: "text/html",
        body: "<!doctype html><html>not a repo</html>",
      },
    });
    expect(await isGitRepoUrl("https://example.com/blog/post", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(false);
  });

  test("a 404 from the discovery endpoint is rejected", async () => {
    const { impl } = fakeFetch({});
    expect(await isGitRepoUrl("https://example.com/nope", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(false);
  });

  test("follows a redirect and still accepts", async () => {
    const { impl } = fakeFetch({
      "http://git.example.com/me/thing/info/refs?service=git-upload-pack": {
        status: 301,
        location: "https://git.example.com/me/thing/info/refs?service=git-upload-pack",
      },
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack": {
        contentType: "application/x-git-upload-pack-advertisement",
        body: ADVERT,
      },
    });
    expect(await isGitRepoUrl("http://git.example.com/me/thing", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(true);
  });

  test("a redirect to an internal address is blocked", async () => {
    const { impl } = fakeFetch({
      "https://git.example.com/me/thing/info/refs?service=git-upload-pack": {
        status: 302,
        location: "http://169.254.169.254/latest/meta-data/",
      },
    });
    const hostIsPublic = async (h: string) => h !== "169.254.169.254";
    expect(await isGitRepoUrl("https://git.example.com/me/thing", { hostIsPublic, fetchImpl: impl })).toBe(false);
  });

  test("an internal host is never fetched at all", async () => {
    const { impl, calls } = fakeFetch({});
    const hostIsPublic = async () => false;
    expect(await isGitRepoUrl("http://localhost:3000/x/y", { hostIsPublic, fetchImpl: impl })).toBe(false);
    expect(calls).toEqual([]);
  });

  test("a dangerous scheme never reaches the probe", async () => {
    const { impl, calls } = fakeFetch({});
    expect(await isGitRepoUrl("javascript:alert(1)", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(false);
    expect(calls).toEqual([]);
  });

  test("a redirect loop gives up instead of hanging", async () => {
    const impl = (async () =>
      new Response("", {
        status: 302,
        headers: { location: "https://git.example.com/a/b/info/refs?service=git-upload-pack" },
      })) as unknown as typeof fetch;
    expect(await isGitRepoUrl("https://git.example.com/a/b", { hostIsPublic: allPublic, fetchImpl: impl })).toBe(false);
  });
});
