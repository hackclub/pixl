# Bklit charts

MIT-licensed chart components from [Bklit UI](https://github.com/bklit/bklit-ui), commit `131f0f08a7165fd64219a5c442f5d309828f9947`.

Installed from the upstream `pie-chart` and `bar-chart` registry source, including their shared dependencies. Unused registry modules were omitted. The adjacent LICENSE applies to these files. PIXL's composition and theme adapters live in `app/budget/BudgetCharts.tsx`.

The Bklit area/axis series modules are vendored from the same upstream commit, powering the overview, public stats and tickets charts. Recharts graph usage is being phased out without changing data queries or reviewer/fulfillment logic.
