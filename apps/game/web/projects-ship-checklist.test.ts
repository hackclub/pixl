import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "projects", "index.html"), "utf8");

const start = html.indexOf("// <ship-checklist>");
const end = html.indexOf("// </ship-checklist>");
if (start === -1 || end === -1)
  throw new Error("ship-checklist markers missing from projects/index.html");

type HtProject = { name: string; seconds: number; secondsSinceCutoff?: number };

// The helpers read `document`, `stats` and `Pixl` from the page scope, so the
// extraction injects all three. A fake document is enough here: every one of
// them only ever asks for the Hackatime checkboxes.
function load(opts: {
  checked: string[];
  projects: HtProject[];
  connected?: boolean;
}) {
  const boxes = opts.checked.map((name) => ({ value: name }));
  const document = {
    querySelectorAll(sel: string) {
      if (sel === 'input[name="ht"]:checked') return boxes;
      return [];
    },
  };
  const Pixl = {
    hours: (s: number) => `${Math.round((s / 3600) * 10) / 10}h`,
  };
  const stats = { connected: opts.connected ?? true, projects: opts.projects };

  return new Function(
    "document",
    "stats",
    "Pixl",
    "HT_CUTOFF_MS",
    "HT_CUTOFF_LABEL",
    `${html.slice(start, end)}
     return { checkedHtTotals, checkedHtSeconds, shipHtLine, htBlockerText };`,
  )(document, stats, Pixl, Date.parse("2026-07-18T00:00:00Z"), "Jul 18") as {
    checkedHtTotals: () => { counted: number; total: number };
    checkedHtSeconds: () => number;
    shipHtLine: (isHardware: boolean) => string;
    htBlockerText: () => string;
  };
}

const TWO_HOURS = 7200;

describe("ship checklist Hackatime line", () => {
  test("counts a ticked project's post-cutoff hours as met", () => {
    const api = load({
      checked: ["pixl"],
      projects: [{ name: "pixl", seconds: TWO_HOURS, secondsSinceCutoff: TWO_HOURS }],
    });
    expect(api.checkedHtSeconds()).toBe(TWO_HOURS);
    expect(api.shipHtLine(false)).toContain(">+<");
  });

  test("hardware is met even with nothing tracked", () => {
    const api = load({ checked: [], projects: [] });
    expect(api.shipHtLine(true)).toContain(">+<");
  });

  // This is the state the bug rendered in: the project genuinely has linked
  // Hackatime projects with hours, but the picker holding those checkboxes is
  // not in the DOM yet, so the line reads 0h and claims the hour floor is
  // unmet. The helper is right to report 0 for an empty picker - the defect
  // was calling it before the picker existed, which the render-order test
  // below pins down.
  test("an absent picker reads as zero, so the line must not be built before it exists", () => {
    const api = load({
      checked: [],
      projects: [{ name: "pixl", seconds: TWO_HOURS, secondsSinceCutoff: TWO_HOURS }],
    });
    expect(api.checkedHtSeconds()).toBe(0);
    expect(api.shipHtLine(false)).toContain(">-<");
  });

  test("only post-cutoff time counts toward the floor", () => {
    const api = load({
      checked: ["old"],
      projects: [{ name: "old", seconds: TWO_HOURS, secondsSinceCutoff: 0 }],
    });
    expect(api.checkedHtSeconds()).toBe(0);
    expect(api.shipHtLine(false)).toContain(">-<");
    // Still reports the linked total so the player can see why it doesn't count.
    expect(api.shipHtLine(false)).toContain("2h linked");
  });
});

describe("renderProject refreshes the line after the picker is mounted", () => {
  // The regression itself. renderProject builds one template literal and only
  // then assigns it to view.innerHTML, so the ${shipHtLine(...)} inside it runs
  // against whatever DOM came before: the project list, the boot spinner, or
  // the previously-viewed project's picker (which made another project's
  // ticked boxes count toward this one). The line has to be recomputed once
  // the real picker is mounted.
  const wiring = html.slice(html.indexOf("const onHtChange ="));

  test("onHtChange runs immediately after wireHtPicker, not only on change", () => {
    const wire = wiring.indexOf("wireHtPicker(onHtChange);");
    expect(wire).toBeGreaterThan(-1);
    const after = wiring.slice(wire, wire + 900);
    expect(after).toMatch(/wireHtPicker\(onHtChange\);\s*(\/\/[^\n]*\n\s*)*onHtChange\(\);/);
  });

  // Same staleness, different trigger: a manual Hackatime refresh swaps in new
  // `stats` and re-renders the picker, so the line's inputs changed without
  // anyone ticking a box.
  test("a Hackatime refresh recomputes the line too", () => {
    const refresh = html.slice(html.indexOf("async function refreshHackatimeStats("));
    const wire = refresh.indexOf("wireHtPicker(onChange);");
    expect(wire).toBeGreaterThan(-1);
    const after = refresh.slice(wire, wire + 900);
    expect(after).toMatch(/wireHtPicker\(onChange\);\s*(\/\/[^\n]*\n\s*)*onChange\?\.\(\);/);
  });
});
