"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import Icon from "@hackclub/icons";
import { saveStaffSettings } from "@/app/actions";
import { Card, DescriptionList, Mono } from "@/app/_ui/ui";
import {
  ACCENTS,
  FONT_INFO,
  FONTS,
  MONO_FONT_INFO,
  MONO_FONTS,
  THEME_INFO,
  THEMES,
  type StaffSettings,
  type Theme,
} from "@/lib/staffSettings";

const SECTIONS = [
  { id: "appearance", label: "Appearance", glyph: "photo" },
  { id: "fonts", label: "Fonts", glyph: "code" },
  { id: "review", label: "Review", glyph: "checkmark" },
  { id: "account", label: "Account", glyph: "person" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

const ACCENT_LABEL: Record<(typeof ACCENTS)[number], string> = {
  theme: "Match theme",
  red: "Red",
  orange: "Orange",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
};

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="hc-setting-row cursor-pointer">
      <span className="min-w-0">
        <span className="block font-bold">{label}</span>
        <span className="hc-caption block text-sm">{hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="hc-switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function ThemeCard({ theme, selected, onPick }: { theme: Theme; selected: boolean; onPick: () => void }) {
  const info = THEME_INFO[theme];
  const vars = {
    "--p-bg": info.preview.bg,
    "--p-surface": info.preview.surface,
    "--p-text": info.preview.text,
    "--p-primary": info.preview.primary,
  } as CSSProperties;
  return (
    <button type="button" className="hc-theme-card" aria-pressed={selected} onClick={onPick}>
      <span className="hc-theme-preview" style={vars} aria-hidden>
        <span className="hc-theme-preview-title" />
        <span className="hc-theme-preview-panel">
          <span className="hc-theme-preview-dot" />
          <span className="hc-theme-preview-line" />
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 px-1">
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">{info.label}</span>
          <span className="hc-caption block truncate text-xs">{info.note}</span>
        </span>
        {selected && <Icon glyph="checkmark" size={20} aria-hidden />}
      </span>
    </button>
  );
}

function FontCard({
  label,
  note,
  css,
  sample,
  selected,
  onPick,
}: {
  label: string;
  note: string;
  css: string;
  sample: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button type="button" className="hc-theme-card" aria-pressed={selected} onClick={onPick}>
      <span className="hc-font-sample" style={{ fontFamily: css }}>
        {sample}
      </span>
      <span className="flex items-center justify-between gap-2 px-1">
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">{label}</span>
          <span className="hc-caption block truncate text-xs">{note}</span>
        </span>
        {selected && <Icon glyph="checkmark" size={20} aria-hidden />}
      </span>
    </button>
  );
}

// The settings page: a sidebar of sections, each saved to the signed-in
// account as soon as it changes.
export default function SettingsClient({
  initial,
  account,
}: {
  initial: StaffSettings;
  account: { name: string; slackId: string | null };
}) {
  const [settings, setSettings] = useState(initial);
  const [section, setSection] = useState<Section>("appearance");
  const [failed, setFailed] = useState(false);
  const [saving, startSaving] = useTransition();

  // #review / #account deep-link straight to a section.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (SECTIONS.some((s) => s.id === fromHash)) setSection(fromHash as Section);
  }, []);

  function pick(next: Section) {
    setSection(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  function update(patch: Partial<StaffSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    // Apply right away; the server renders the same attributes on the next load.
    const el = document.documentElement;
    el.dataset.theme = next.theme;
    el.dataset.accent = next.accent;
    el.dataset.font = next.font;
    el.dataset.monoFont = next.monoFont;
    el.dataset.density = next.compact ? "compact" : "normal";
    startSaving(async () => {
      try {
        const result = await saveStaffSettings(next);
        setFailed(!result.ok);
      } catch {
        setFailed(true);
      }
    });
  }

  let status = "Saved to your account.";
  if (saving) status = "Saving...";
  else if (failed) status = "Couldn't save that. It will reset when you reload.";

  return (
    <div className="hc-settings-layout">
      <nav className="hc-settings-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="hc-settings-nav-item"
            aria-current={section === s.id ? "page" : undefined}
            onClick={() => pick(s.id)}
          >
            <Icon glyph={s.glyph} size={20} aria-hidden />
            {s.label}
          </button>
        ))}
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        {section === "appearance" && (
          <>
            <Card>
              <h2 className="hc-heading text-base">Theme</h2>
              <p className="hc-caption mt-1 mb-4 text-sm">The whole dashboard switches as soon as you pick one.</p>
              <div className="hc-theme-grid">
                {THEMES.map((theme) => (
                  <ThemeCard
                    key={theme}
                    theme={theme}
                    selected={settings.theme === theme}
                    onPick={() => update({ theme })}
                  />
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="hc-heading text-base">Accent color</h2>
              <p className="hc-caption mt-1 mb-4 text-sm">
                Buttons, links and highlights. Match theme uses the theme&apos;s own color.
              </p>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map((accent) => (
                  <button
                    key={accent}
                    type="button"
                    className="hc-swatch"
                    data-accent={accent}
                    aria-pressed={settings.accent === accent}
                    aria-label={ACCENT_LABEL[accent]}
                    title={ACCENT_LABEL[accent]}
                    onClick={() => update({ accent })}
                  />
                ))}
              </div>
            </Card>

            <Card>
              <div className="flex flex-col">
                <Toggle
                  label="Compact mode"
                  hint="Tighter tables and smaller text, to fit more on screen."
                  checked={settings.compact}
                  onChange={(compact) => update({ compact })}
                />
              </div>
            </Card>
          </>
        )}

        {section === "fonts" && (
          <>
            <Card>
              <h2 className="hc-heading text-base">Interface font</h2>
              <p className="hc-caption mt-1 mb-4 text-sm">Headings, tables and body text across the dashboard.</p>
              <div className="hc-font-grid">
                {FONTS.map((font) => (
                  <FontCard
                    key={font}
                    {...FONT_INFO[font]}
                    sample="Ship it, pixel pal"
                    selected={settings.font === font}
                    onPick={() => update({ font })}
                  />
                ))}
              </div>
            </Card>

            <Card>
              <h2 className="hc-heading text-base">Code font</h2>
              <p className="hc-caption mt-1 mb-4 text-sm">IDs, hours, tabs, buttons and anything code-like.</p>
              <div className="hc-font-grid">
                {MONO_FONTS.map((monoFont) => (
                  <FontCard
                    key={monoFont}
                    {...MONO_FONT_INFO[monoFont]}
                    sample="#1042 => 3h 20m"
                    selected={settings.monoFont === monoFont}
                    onPick={() => update({ monoFont })}
                  />
                ))}
              </div>
            </Card>
          </>
        )}

        {section === "review" && (
          <>
            <Card>
              <h2 className="hc-heading text-base">Review defaults</h2>
              <p className="hc-caption mt-1 mb-4 text-sm">
                Default checkboxes on the verdict form when you review a project.
              </p>
              <div className="flex flex-col">
                <Toggle
                  label="Show name to player"
                  hint="Include your name in verdict notifications by default instead of sending as &quot;the review team&quot;."
                  checked={settings.reviewRevealName}
                  onChange={(reviewRevealName) => update({ reviewRevealName })}
                />
                <Toggle
                  label="Notify on resubmit"
                  hint="Default to requesting a Slack DM when a project you requested changes on is resubmitted."
                  checked={settings.reviewNotifyOnResubmit}
                  onChange={(reviewNotifyOnResubmit) => update({ reviewNotifyOnResubmit })}
                />
              </div>
            </Card>

            <Card>
              <h2 className="hc-heading text-base">After a review</h2>
              <div className="mt-2 flex flex-col">
                <Toggle
                  label="Review sound"
                  hint="A short sound after you submit a review."
                  checked={settings.sound}
                  onChange={(sound) => update({ sound })}
                />
                <Toggle
                  label="Confetti"
                  hint="Confetti after you submit a review."
                  checked={settings.confetti}
                  onChange={(confetti) => update({ confetti })}
                />
              </div>
            </Card>
          </>
        )}

        {section === "account" && (
          <Card>
            <h2 className="hc-heading mb-3 text-base">Signed in as</h2>
            <DescriptionList
              items={[
                ["Name", account.name],
                ["Slack ID", account.slackId ? <Mono key="slack">{account.slackId}</Mono> : "Hidden in live mode"],
              ]}
            />
            <p className="hc-caption mt-3 text-sm">
              Your role comes from the team list, not from here. Ask an owner if it looks wrong.
            </p>
          </Card>
        )}

        {section !== "account" && (
          <p className="hc-save-status" data-tone={failed && !saving ? "danger" : undefined}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
