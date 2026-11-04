import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const actions = readFileSync(new URL("./OrderActions.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./OrderDetail.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../_ui/admin.css", import.meta.url), "utf8");

describe("fulfillment action layout", () => {
  test("order crediting keeps its fields and submit button in separate rows", () => {
    const ordered = actions.slice(
      actions.indexOf('if (o.status === "ordered")'),
      actions.indexOf("// Credited -> shipped"),
    );
    expect(ordered).toContain('className="fw-order-action-form"');
    expect(ordered).toContain('className="fw-order-action-fields"');
    expect(ordered).toContain('className="fw-order-action-buttons"');
    expect(ordered).toContain('className="fw-order-action-field-wide"');
    expect(ordered.indexOf("</form>")).toBeLessThan(ordered.indexOf("{cancelForm}"));
    for (const field of ["hcbLink", "actualCostUsd", "sourceUrl"]) {
      expect(ordered).toContain(`name="${field}"`);
    }
  });

  test("actions occupy a separate full-width panel below the info grid", () => {
    const grid = detail.indexOf('<div className="fw-cols">');
    const actionsPanel = detail.indexOf('<Panel title="Actions" icon="bolt">');
    const funding = detail.indexOf("<FundingDisclosure");
    expect(grid).toBeGreaterThan(-1);
    expect(actionsPanel).toBeGreaterThan(grid);
    expect(actionsPanel).toBeLessThan(funding);
    expect(detail.slice(grid, actionsPanel)).toContain('<Panel title="Shipping info"');
  });

  test("forms use shrinkable columns and responsive wrapping", () => {
    expect(css).toContain(".fw-order-action-fields {");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(css).toContain(".fw-order-action-field-wide { grid-column: 1 / -1; }");
    expect(css).toContain("@media (max-width: 680px)");
    expect(css).toContain(".fw-order-action-buttons .hc-btn");
    expect(css).toContain("white-space: normal;");
  });
});
