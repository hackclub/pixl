import { afterEach, describe, expect, test } from "bun:test";
import { fetchRepositorySnapshot } from "./repositorySnapshot";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchRepositorySnapshot", () => {
  test("includes readable source and README files while omitting unsafe paths", async () => {
    const fakeFetch = Object.assign(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/repos/acme/demo"))
        return new Response(JSON.stringify({ private: false, default_branch: "main" }));
      if (url.includes("/git/trees/main"))
        return new Response(JSON.stringify({
          sha: "revision-sha",
          tree: [
            { path: "README.md", type: "blob", size: 20 },
            { path: ".env", type: "blob", size: 20 },
            { path: "node_modules/pkg/index.js", type: "blob", size: 20 },
            { path: "src/main.ts", type: "blob", size: 20 },
            { path: "preview.png", type: "blob", size: 20 },
          ],
        }));
      if (url.includes("/commits?per_page=50")) return new Response(JSON.stringify([]));
      if (url.endsWith("/README.md")) return new Response("# Demo");
      if (url.endsWith("/src/main.ts")) return new Response("export const demo = true;");
      return new Response("not found", { status: 404 });
    }, { preconnect: originalFetch.preconnect });
    globalThis.fetch = fakeFetch;

    const snapshot = await fetchRepositorySnapshot("https://github.com/acme/demo");

    expect(snapshot.revision).toBe("revision-sha");
    expect(snapshot.files.map((file) => file.path)).toEqual(["README.md", "src/main.ts"]);
    expect(snapshot.filesSeen).toBe(2);
    expect(snapshot.filesOmitted).toBe(3);
  });
});
