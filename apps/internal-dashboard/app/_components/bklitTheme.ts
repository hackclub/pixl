import type { CSSProperties } from "react";

// Adapt the MIT-licensed Bklit charts to PIXL's existing theme tokens.
export const BKLIT_THEME = {
  "--foreground": "var(--text)",
  "--chart-label": "var(--secondary)",
  "--chart-grid": "var(--border-strong)",
  "--chart-line-primary": "var(--hc-cyan)",
  "--chart-foreground-muted": "var(--muted)",
  "--card": "var(--surface)",
  "--muted-foreground": "var(--secondary)",
} as CSSProperties;
