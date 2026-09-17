import { afterEach, describe, expect, test } from "bun:test";
import { fetchCommits, parseRepoRef } from "./commits";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Route table keyed by URL; anything unrouted 404s, like a real host would. */
function routeFetch(routes: Record<string, { status?: number; json?: unknown; text?: string }>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response("not found", { status: 404 });
    if (r.text !== undefined) return new Response(r.text, { status: r.status ?? 200 });
    return new Response(JSON.stringify(r.json ?? []), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return calls;
}

describe("parseRepoRef", () => {
  test("github", () => expect(parseRepoRef("https://github.com/ridit/pixl")).toMatchObject({ provider: "github", path: "ridit/pixl" }));
  test("github with .git", () => expect(parseRepoRef("https://github.com/ridit/pixl.git")?.path).toBe("ridit/pixl"));
  test("codeberg maps to forgejo", () => expect(parseRepoRef("https://codeberg.org/brandt/thing")).toMatchObject({ provider: "forgejo", path: "brandt/thing" }));
  test("gitlab", () => expect(parseRepoRef("https://gitlab.com/group/proj")).toMatchObject({ provider: "gitlab", path: "group/proj" }));
  test("gitlab subgroups keep the full path", () =>
    expect(parseRepoRef("https://gitlab.com/group/sub/proj")?.path).toBe("group/sub/proj"));
  test("gitlab strips everything after /-/", () =>
    expect(parseRepoRef("https://gitlab.com/group/proj/-/tree/main")?.path).toBe("group/proj"));
  test("unknown host has no provider yet", () =>
    expect(parseRepoRef("https://git.example.com/me/thing")).toMatchObject({ provider: null, path: "me/thing" }));
  test("strips www", () => expect(parseRepoRef("https://www.github.com/a/b")?.host).toBe("github.com"));
  test("rejects a bare origin", () => expect(parseRepoRef("https://github.com/ridit")).toBeNull());
  test("rejects a dangerous scheme", () => expect(parseRepoRef("javascript:alert(1)")).toBeNull());
  test("rejects null", () => expect(parseRepoRef(null)).toBeNull());
});

const FORGEJO_JSON = [
  {
    sha: "abc1234def5678",
    html_url: "https://codeberg.org/brandt/thing/commit/abc1234",
    commit: { message: "add the thing\n\nbody", author: { name: "Brandt", email: "b@example.com", date: "2026-09-01T10:00:00Z" } },
    author: { login: "brandt" },
    stats: { additions: 12, deletions: 3 },
  },
];

const GITLAB_JSON = [
  {
    id: "def567890abc",
    short_id: "def5678",
    title: "fix the thing",
    message: "fix the thing\n",
    author_name: "Someone",
    author_email: "s@example.com",
    committed_date: "2026-09-02T10:00:00Z",
    web_url: "https://gitlab.com/group/proj/-/commit/def5678",
    stats: { additions: 4, deletions: 1 },
  },
];

describe("fetchCommits", () => {
  test("codeberg goes straight to the forgejo api", async () => {
    const calls = routeFetch({
      "https://codeberg.org/api/v1/repos/brandt/thing/commits?limit=50&stat=true": { json: FORGEJO_JSON },
    });
    const r = await fetchCommits("https://codeberg.org/brandt/thing");
    expect(r.error).toBeNull();
    expect(r.provider).toBe("forgejo");
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]).toMatchObject({ sha: "abc1234", message: "add the thing", author: "brandt", additions: 12, deletions: 3 });
    expect(calls).toHaveLength(1);
  });

  test("gitlab url-encodes the project path", async () => {
    routeFetch({
      "https://gitlab.com/api/v4/projects/group%2Fsub%2Fproj/repository/commits?per_page=50&with_stats=true": { json: GITLAB_JSON },
    });
    const r = await fetchCommits("https://gitlab.com/group/sub/proj");
    expect(r.error).toBeNull();
    expect(r.provider).toBe("gitlab");
    expect(r.commits[0]).toMatchObject({ sha: "def5678", message: "fix the thing", author: "Someone", additions: 4 });
  });

  test("a self-hosted forgejo is found by probing", async () => {
    const calls = routeFetch({
      "https://gitea.example.com/api/v1/repos/me/thing/commits?limit=50&stat=true": { json: FORGEJO_JSON },
    });
    const r = await fetchCommits("https://gitea.example.com/me/thing");
    expect(r.provider).toBe("forgejo");
    expect(r.commits).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test("a self-hosted gitlab is found after forgejo misses", async () => {
    const calls = routeFetch({
      "https://glab.example.com/api/v4/projects/me%2Fthing/repository/commits?per_page=50&with_stats=true": { json: GITLAB_JSON },
    });
    const r = await fetchCommits("https://glab.example.com/me/thing");
    expect(r.provider).toBe("gitlab");
    expect(calls).toHaveLength(2); // forgejo probed first, then gitlab
  });

  test("a host answering neither api reports unsupported_host", async () => {
    routeFetch({});
    const r = await fetchCommits("https://blog.example.com/some/post");
    expect(r.error).toBe("unsupported_host");
    expect(r.commits).toEqual([]);
  });

  test("a host serving html instead of json is not mistaken for a repo", async () => {
    routeFetch({
      "https://html.example.com/api/v1/repos/me/thing/commits?limit=50&stat=true": { text: "<!doctype html><html></html>" },
      "https://html.example.com/api/v4/projects/me%2Fthing/repository/commits?per_page=50&with_stats=true": { text: "<!doctype html>" },
    });
    const r = await fetchCommits("https://html.example.com/me/thing");
    expect(r.error).toBe("unsupported_host");
  });

  test("a known host 404 is not_found, not a silent probe miss", async () => {
    routeFetch({});
    const r = await fetchCommits("https://codeberg.org/nobody/nothing");
    expect(r.error).toBe("not_found");
    expect(r.provider).toBe("forgejo");
  });

  test("a non-repo url is rejected before any request", async () => {
    const calls = routeFetch({});
    const r = await fetchCommits("javascript:alert(1)");
    expect(r.error).toBe("unsupported_host");
    expect(calls).toEqual([]);
  });

  test("no repo url is not an error", async () => {
    const r = await fetchCommits(null);
    expect(r).toEqual({ repo: null, commits: [], error: null });
  });

  test("flags an AI co-author trailer on a non-github host", async () => {
    routeFetch({
      "https://codeberg.org/api/v1/repos/a/b/commits?limit=50&stat=true": {
        json: [
          {
            sha: "1111111",
            commit: { message: "do it\n\nCo-Authored-By: Claude <noreply@anthropic.com>", author: { name: "x", email: "x@e.com", date: "2026-09-01T00:00:00Z" } },
          },
        ],
      },
    });
    const r = await fetchCommits("https://codeberg.org/a/b");
    expect(r.commits[0].ai).toBe(true);
  });
});
