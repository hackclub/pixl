import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Privacy contract: the dashboard deanonymizes serial reporters to
// report-viewers at its repeat threshold (see app/reports/page.tsx and
// app/reports/[id]/page.tsx, REPEAT_THRESHOLD), so the report form must not
// promise unconditional anonymity. These tests pin the disclosure in place.
const html = readFileSync(join(import.meta.dir, "report", "index.html"), "utf8");

describe("report anonymity disclosure", () => {
  test("the form still offers anonymous reporting by default", () => {
    expect(html).toContain('id="anon" checked');
  });

  test("the form discloses the repeat-report exception", () => {
    const label = html.match(/<label class="check-row">.*?<\/label>/s)?.[0] ?? "";
    expect(label).toMatch(/anonymously/i);
    // Must disclose that repeated reports reveal the reporter's name to
    // reviewers - an unconditional promise here would contradict the
    // dashboard's serial-reporter reveal.
    expect(label).toMatch(/repeat/i);
    expect(label).toMatch(/reveal/i);
  });
});
