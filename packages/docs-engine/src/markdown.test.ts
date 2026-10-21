import { describe, expect, test } from "bun:test";
import { render } from "./markdown.ts";

// The rendered body lands in dangerouslySetInnerHTML on the public /docs
// page. Link targets are the one place the renderer used to copy source text
// into an attribute without escaping it, so they are pinned down here.

const doc = (body: string) => render(`---\ntitle: T\ngroup: G\ndescription: D\n---\n${body}\n`, {}).body;

describe("render links", () => {
  test("keeps http(s), mailto, site-relative and anchor targets", () => {
    expect(doc("[a](https://hackclub.com/x?y=1&z=2)")).toBe(
      '<p><a href="https://hackclub.com/x?y=1&amp;z=2">a</a></p>',
    );
    expect(doc("[a](http://example.com)")).toBe('<p><a href="http://example.com">a</a></p>');
    expect(doc("[a](mailto:team@hackclub.com)")).toBe('<p><a href="mailto:team@hackclub.com">a</a></p>');
    expect(doc("[a](/docs/git/)")).toBe('<p><a href="/docs/git/">a</a></p>');
    expect(doc("[a](#h-ship)")).toBe('<p><a href="#h-ship">a</a></p>');
    expect(doc("[a](fallout.hackclub.com)")).toBe('<p><a href="fallout.hackclub.com">a</a></p>');
  });

  test("drops the link for any other scheme and keeps the text", () => {
    for (const target of [
      "javascript:alert%281%29",
      "JavaScript:alert%281%29",
      "data:text/html,x",
      "vbscript:x",
      "file:///etc/passwd",
      // The trailing backslash-unescape pass would otherwise turn this into
      // a javascript: href after the scheme check ran.
      "javascript\\:alert%281%29",
      "\u0001javascript:alert%281%29",
    ]) {
      expect(doc(`[a](${target})`)).toBe("<p>a</p>");
    }
  });

  test("escapes quotes in the target so it cannot grow extra attributes", () => {
    expect(doc('[a](/x"onmouseover="alert%281%29)')).toBe(
      '<p><a href="/x&quot;onmouseover=&quot;alert%281%29">a</a></p>',
    );
  });

  test("still escapes the link text", () => {
    expect(doc("[<b>](/x)")).toBe('<p><a href="/x">&lt;b&gt;</a></p>');
  });
});
