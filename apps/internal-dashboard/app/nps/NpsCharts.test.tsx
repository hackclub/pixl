import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RatingBars, ScoreColumns, ShareBar, TrendBars } from "./NpsCharts";
import { bucketShares } from "@/lib/npsMath";

describe("NPS charts render", () => {
  test("ShareBar names every bucket with its percentage and count", () => {
    const html = renderToStaticMarkup(<ShareBar shares={bucketShares([10, 10, 8, 3].map((score) => ({ score })))} />);
    expect(html).toContain("Promoters (9-10)");
    expect(html).toContain("Passives (7-8)");
    expect(html).toContain("Detractors (0-6)");
    expect(html).toContain("50%");
    expect(html).toContain('role="img"');
  });

  test("ShareBar with no answers draws no segments and does not divide by zero", () => {
    const html = renderToStaticMarkup(<ShareBar shares={bucketShares([])} />);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  test("ScoreColumns has one column per score, a table view and no NaN", () => {
    const html = renderToStaticMarkup(<ScoreColumns counts={[0, 0, 1, 0, 0, 2, 0, 3, 4, 5, 6]} />);
    for (let s = 0; s <= 10; s++) expect(html).toContain(`title="Score ${s}:`);
    expect(html).toContain("Table view");
    expect(html).not.toContain("NaN");
  });

  test("ScoreColumns with no answers still renders", () => {
    const html = renderToStaticMarkup(<ScoreColumns counts={Array.from({ length: 11 }, () => 0)} />);
    expect(html).not.toContain("NaN");
  });

  test("RatingBars shows the average and says so when an area has no ratings", () => {
    const html = renderToStaticMarkup(
      <RatingBars
        items={[
          { key: "reviews", label: "Review speed and fairness", avg: 3.5, n: 2 },
          { key: "shop", label: "The shop and the prizes", avg: null, n: 0 },
        ]}
      />,
    );
    expect(html).toContain("3.5");
    expect(html).toContain("width:70%");
    expect(html).toContain("no ratings");
  });

  test("TrendBars draws positive to the right and negative to the left of the center", () => {
    const html = renderToStaticMarkup(
      <TrendBars
        points={[
          { wave: "2026-10", n: 4, nps: 50 },
          { wave: "2026-11", n: 3, nps: -33 },
        ]}
      />,
    );
    expect(html).toContain("+50");
    expect(html).toContain("-33");
    expect(html).toContain("left:50%");
    expect(html).toContain("right:50%");
  });
});
