import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { githubRepoOwnerProfile } from "./githubRepoOwner";

describe("GitHub profile shortcut", () => {
  test("links to the owner of a GitHub repository", () => {
    expect(githubRepoOwnerProfile("https://github.com/Some-User/my-project")).toBe("https://github.com/Some-User");
    expect(githubRepoOwnerProfile("https://www.github.com/Org/repo.git/tree/main")).toBe("https://github.com/Org");
    expect(githubRepoOwnerProfile("http://github.com/demo/repo?tab=readme")).toBe("https://github.com/demo");
  });

  test("hides the shortcut for non-GitHub or invalid repositories", () => {
    for (const url of [
      null,
      "",
      "https://codeberg.org/person/project",
      "https://github.com/person",
      "https://github.com.evil.test/person/project",
      "https://github.com@evil.test/person/project",
      "https://user:pass@github.com/person/project",
      "https://github.com:8443/person/project",
      "javascript:alert(1)",
      "https://github.com/-invalid/repo",
      "https://github.com/invalid-/repo",
    ]) {
      expect(githubRepoOwnerProfile(url)).toBeNull();
    }
  });

  test("renders the button beside Repo only when a profile link exists", () => {
    const source = readFileSync(new URL("../app/review/[id]/page.tsx", import.meta.url), "utf8");
    expect(source).toContain("githubRepoOwnerProfile(repoUrl)");
    expect(source).toContain("{githubOwnerProfile && (");
    expect(source).toContain('href={githubOwnerProfile} external variant="outline"');
    expect(source).toContain("GitHub profile");
    expect(source.indexOf("GitHub profile")).toBeGreaterThan(source.indexOf(">\n              Repo"));
    expect(source.indexOf("GitHub profile")).toBeLessThan(source.indexOf("README\n"));
  });
});
