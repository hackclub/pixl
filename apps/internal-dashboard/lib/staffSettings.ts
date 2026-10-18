// Per-staff dashboard preferences. This file is plain data and parsing so the
// client settings menu can import it; the DB read/write is in lib/db.ts.

export const THEMES = [
  "system",
  "dark",
  "light",
  "jetbrains",
  "cursor",
  "tokyo-night",
  "dracula",
  "catppuccin",
  "nord",
  "gruvbox",
  "one-dark",
  "rose-pine",
  "solarized-light",
] as const;
// "theme" uses the selected theme's own accent (red for System/Dark/Light).
export const ACCENTS = ["theme", "red", "orange", "green", "cyan", "blue", "purple"] as const;

// Interface and code fonts (app/fonts.ts loads them, app/_ui/fonts.css applies them).
export const FONTS = ["phantom", "system", "inter", "geist", "ibm-plex-sans", "atkinson"] as const;
export const MONO_FONTS = [
  "jetbrains-mono",
  "geist-mono",
  "fira-code",
  "ibm-plex-mono",
  "source-code-pro",
  "system-mono",
] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type Font = (typeof FONTS)[number];
export type MonoFont = (typeof MONO_FONTS)[number];

// Picker labels; `css` is the font-family the preview card renders in.
export const FONT_INFO: Record<Font, { label: string; note: string; css: string }> = {
  phantom: { label: "Phantom Sans", note: "Hack Club's typeface", css: '"Phantom Sans", system-ui, sans-serif' },
  system: { label: "System", note: "Your OS font", css: "system-ui, sans-serif" },
  inter: { label: "Inter", note: "Neutral, very readable", css: "var(--font-inter), system-ui, sans-serif" },
  geist: { label: "Geist", note: "Clean and modern", css: "var(--font-geist), system-ui, sans-serif" },
  "ibm-plex-sans": { label: "IBM Plex Sans", note: "Technical feel", css: "var(--font-plex-sans), system-ui, sans-serif" },
  atkinson: {
    label: "Atkinson Hyperlegible",
    note: "Built for low vision",
    css: "var(--font-atkinson), system-ui, sans-serif",
  },
};

export const MONO_FONT_INFO: Record<MonoFont, { label: string; note: string; css: string }> = {
  "jetbrains-mono": { label: "JetBrains Mono", note: "The default", css: "var(--font-jetbrains-mono), monospace" },
  "geist-mono": { label: "Geist Mono", note: "Pairs with Geist", css: "var(--font-geist-mono), monospace" },
  "fira-code": { label: "Fira Code", note: "With ligatures", css: "var(--font-fira-code), monospace" },
  "ibm-plex-mono": { label: "IBM Plex Mono", note: "Pairs with Plex Sans", css: "var(--font-plex-mono), monospace" },
  "source-code-pro": { label: "Source Code Pro", note: "Adobe's classic", css: "var(--font-source-code-pro), monospace" },
  "system-mono": { label: "System mono", note: "SF Mono, Consolas...", css: "ui-monospace, Menlo, Consolas, monospace" },
};

export interface StaffSettings {
  theme: Theme;
  accent: Accent;
  font: Font;
  monoFont: MonoFont;
  compact: boolean;
  /** Confetti after a review. Off unless someone turns it on. */
  confetti: boolean;
  /** The short sound after a review. On unless someone turns it off. */
  sound: boolean;
  /** Width in px of the review page's right column (see ReviewSplit). */
  reviewPanelWidth: number;
  /** Show reviewer's name in verdict notifications by default. On unless turned off. */
  reviewRevealName: boolean;
  /** Request a DM on Slack by default when requesting changes. Off unless turned on. */
  reviewNotifyOnResubmit: boolean;
}

// What the settings page shows for each theme. The colours themselves live in
// app/_ui/themes.css; `preview` is only the little card in the picker.
export const THEME_INFO: Record<
  Theme,
  { label: string; note: string; preview: { bg: string; surface: string; text: string; primary: string } }
> = {
  system: {
    label: "System",
    note: "Follows your OS light/dark setting",
    preview: { bg: "#131418", surface: "#f9fafc", text: "#8492a6", primary: "#ec3750" },
  },
  dark: { label: "Dark", note: "Hack Club dark", preview: { bg: "#131418", surface: "#17171d", text: "#f4f4f6", primary: "#ec3750" } },
  light: { label: "Light", note: "Hack Club light", preview: { bg: "#f9fafc", surface: "#ffffff", text: "#1f2d3d", primary: "#ec3750" } },
  jetbrains: { label: "JetBrains", note: "IntelliJ New UI dark", preview: { bg: "#1e1f22", surface: "#2b2d30", text: "#dfe1e5", primary: "#3574f0" } },
  cursor: { label: "Cursor", note: "Cursor dark", preview: { bg: "#141414", surface: "#1c1c1c", text: "#e4e4e4", primary: "#3c9cfc" } },
  "tokyo-night": { label: "Tokyo Night", note: "Night variant", preview: { bg: "#1a1b26", surface: "#1f2335", text: "#c0caf5", primary: "#7aa2f7" } },
  dracula: { label: "Dracula", note: "Classic purple", preview: { bg: "#282a36", surface: "#303241", text: "#f8f8f2", primary: "#bd93f9" } },
  catppuccin: { label: "Catppuccin", note: "Mocha", preview: { bg: "#181825", surface: "#1e1e2e", text: "#cdd6f4", primary: "#cba6f7" } },
  nord: { label: "Nord", note: "Arctic blue", preview: { bg: "#2e3440", surface: "#3b4252", text: "#eceff4", primary: "#88c0d0" } },
  gruvbox: { label: "Gruvbox", note: "Retro dark", preview: { bg: "#282828", surface: "#32302f", text: "#ebdbb2", primary: "#fe8019" } },
  "one-dark": { label: "One Dark", note: "Atom One Dark", preview: { bg: "#21252b", surface: "#282c34", text: "#d7dae0", primary: "#61afef" } },
  "rose-pine": { label: "Rosé Pine", note: "Main", preview: { bg: "#191724", surface: "#1f1d2e", text: "#e0def4", primary: "#ebbcba" } },
  "solarized-light": {
    label: "Solarized Light",
    note: "Warm light",
    preview: { bg: "#fdf6e3", surface: "#fffdf6", text: "#073642", primary: "#268bd2" },
  },
};

export const DEFAULT_STAFF_SETTINGS: StaffSettings = {
  theme: "system",
  accent: "theme",
  font: "phantom",
  monoFont: "jetbrains-mono",
  compact: false,
  confetti: false,
  sound: true,
  reviewPanelWidth: 460,
  reviewRevealName: true,
  reviewNotifyOnResubmit: false,
};

export const REVIEW_PANEL_MIN = 360;
export const REVIEW_PANEL_MAX = 1000;

export function clampReviewPanelWidth(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : DEFAULT_STAFF_SETTINGS.reviewPanelWidth;
  return Math.min(REVIEW_PANEL_MAX, Math.max(REVIEW_PANEL_MIN, n));
}

// Anything unknown or malformed falls back to the default for that field, so a
// stored row can never put the dashboard in a state the CSS doesn't know.
export function parseStaffSettings(raw: unknown): StaffSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: THEMES.includes(r.theme as Theme) ? (r.theme as Theme) : DEFAULT_STAFF_SETTINGS.theme,
    accent: ACCENTS.includes(r.accent as Accent) ? (r.accent as Accent) : DEFAULT_STAFF_SETTINGS.accent,
    font: FONTS.includes(r.font as Font) ? (r.font as Font) : DEFAULT_STAFF_SETTINGS.font,
    monoFont: MONO_FONTS.includes(r.monoFont as MonoFont) ? (r.monoFont as MonoFont) : DEFAULT_STAFF_SETTINGS.monoFont,
    compact: r.compact === true,
    confetti: r.confetti === true,
    sound: r.sound !== false,
    reviewPanelWidth: clampReviewPanelWidth(r.reviewPanelWidth),
    reviewRevealName: r.reviewRevealName !== false,
    reviewNotifyOnResubmit: r.reviewNotifyOnResubmit === true,
  };
}
