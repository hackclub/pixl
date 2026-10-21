import { describe, expect, test } from "bun:test";
import { render } from "./markdown.ts";

const frontmatter = ["---", "title: Test", "group: Test", "description: Test", "---", ""].join("\n");

function renderBody(markdown: string): string {
  return render(frontmatter + markdown, {}).body;
}

describe("docs Markdown links", () => {
  test("preserves supported schemes and relative links", () => {
    const body = renderBody(
      "[web](https://example.com/path?a=1&b=2) [email](mailto:hello@example.com) [guide](/docs/guide) [section](#setup)",
    );

    expect(body).toContain('<a href="https://example.com/path?a=1&amp;b=2">web</a>');
    expect(body).toContain('<a href="mailto:hello@example.com">email</a>');
    expect(body).toContain('<a href="/docs/guide">guide</a>');
    expect(body).toContain('<a href="#setup">section</a>');
  });

  test("renders active URL schemes as text", () => {
    const body = renderBody(
      "[js](javascript:alert) [data](data:text/html,boom) [vb](vbscript:msgbox) [file](file:///tmp/x)",
    );

    expect(body).not.toContain("<a href=");
    expect(body).toContain("js data vb file");
  });

  test("rejects backslashes and control characters in URL targets", () => {
    const backslash = "java" + String.fromCharCode(92) + "script:alert";
    const nul = "java" + String.fromCharCode(0) + "script:alert";
    const body = renderBody("[backslash](" + backslash + ") [nul](" + nul + ")");

    expect(body).not.toContain("<a href=");
    expect(body).toContain("backslash nul");
  });

  test("encodes quotes in link targets", () => {
    const body = renderBody('[x](https://safe.example/"onmouseover="alert(1))');

    expect(body).toContain(
      '<a href="https://safe.example/&quot;onmouseover=&quot;alert(1">x</a>',
    );
    expect(body).not.toContain('<a href="https://safe.example/" onmouseover=');
  });
});

describe("docs Markdown code fences", () => {
  test("keeps ordinary highlighting and encodes language attribute quotes", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const body = renderBody(
      [
        fence + 'ts" onmouseover="alert(1)',
        'console.log("ok")',
        fence,
        fence + "ts",
        "const value = 1;",
        fence,
      ].join("\n"),
    );

    expect(body).toContain(
      '<code class="language-ts&quot; onmouseover=&quot;alert(1)">',
    );
    expect(body).not.toContain('<code class="language-ts" onmouseover=');
    expect(body).toContain('<code class="language-ts">');
    expect(body).toContain("const value = 1;");
  });
});
