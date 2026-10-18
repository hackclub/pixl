import { describe, expect, test } from "bun:test";
import {
  DEFAULT_STAFF_SETTINGS,
  FONT_INFO,
  FONTS,
  MONO_FONT_INFO,
  MONO_FONTS,
  THEME_INFO,
  THEMES,
  parseStaffSettings,
} from "./staffSettings";

describe("parseStaffSettings", () => {
  test("defaults when nothing is stored", () => {
    expect(parseStaffSettings(null)).toEqual(DEFAULT_STAFF_SETTINGS);
    expect(parseStaffSettings("nope")).toEqual(DEFAULT_STAFF_SETTINGS);
  });

  test("confetti is off unless it is exactly true", () => {
    expect(parseStaffSettings({}).confetti).toBe(false);
    expect(parseStaffSettings({ confetti: "true" }).confetti).toBe(false);
    expect(parseStaffSettings({ confetti: true }).confetti).toBe(true);
  });

  test("keeps valid values and drops unknown ones", () => {
    expect(
      parseStaffSettings({ theme: "light", accent: "blue", compact: true, confetti: true, reviewPanelWidth: 620 }),
    ).toEqual({
      theme: "light",
      accent: "blue",
      font: "phantom",
      monoFont: "jetbrains-mono",
      compact: true,
      confetti: true,
      sound: true,
      reviewPanelWidth: 620,
      reviewRevealName: true,
      reviewNotifyOnResubmit: false,
    });
    expect(parseStaffSettings({ theme: "neon", accent: "javascript:alert(1)", extra: 1 })).toEqual(
      DEFAULT_STAFF_SETTINGS,
    );
  });

  test("accepts the editor themes and the match-theme accent", () => {
    expect(parseStaffSettings({ theme: "dracula", accent: "theme" })).toMatchObject({ theme: "dracula", accent: "theme" });
    expect(parseStaffSettings({ theme: "tokyo-night" }).theme).toBe("tokyo-night");
    // A stored "red" from before the theme accent existed stays red.
    expect(parseStaffSettings({ accent: "red" }).accent).toBe("red");
  });

  test("keeps known fonts and drops anything else", () => {
    expect(parseStaffSettings({ font: "inter", monoFont: "fira-code" })).toMatchObject({ font: "inter", monoFont: "fira-code" });
    expect(parseStaffSettings({ font: "Comic Sans", monoFont: "url(x)" })).toMatchObject({
      font: "phantom",
      monoFont: "jetbrains-mono",
    });
  });

  test("every font has picker info", () => {
    for (const font of FONTS) expect(FONT_INFO[font].label.length).toBeGreaterThan(0);
    for (const font of MONO_FONTS) expect(MONO_FONT_INFO[font].label.length).toBeGreaterThan(0);
  });

  test("every theme has picker info", () => {
    for (const theme of THEMES) expect(THEME_INFO[theme].label.length).toBeGreaterThan(0);
  });

  test("the review sound is on unless it is exactly false", () => {
    expect(parseStaffSettings({}).sound).toBe(true);
    expect(parseStaffSettings({ confetti: true }).sound).toBe(true);
    expect(parseStaffSettings({ sound: "false" }).sound).toBe(true);
    expect(parseStaffSettings({ sound: false }).sound).toBe(false);
  });

  test("review panel width is clamped to a sane range", () => {
    expect(parseStaffSettings({ reviewPanelWidth: 5 }).reviewPanelWidth).toBe(360);
    expect(parseStaffSettings({ reviewPanelWidth: 99999 }).reviewPanelWidth).toBe(1000);
    expect(parseStaffSettings({ reviewPanelWidth: "wide" }).reviewPanelWidth).toBe(460);
  });

  test("show reviewer name is on unless explicitly false", () => {
    expect(parseStaffSettings({}).reviewRevealName).toBe(true);
    expect(parseStaffSettings({ reviewRevealName: "false" }).reviewRevealName).toBe(true);
    expect(parseStaffSettings({ reviewRevealName: false }).reviewRevealName).toBe(false);
    expect(parseStaffSettings({ reviewRevealName: true }).reviewRevealName).toBe(true);
  });

  test("notify on resubmit is off unless explicitly true", () => {
    expect(parseStaffSettings({}).reviewNotifyOnResubmit).toBe(false);
    expect(parseStaffSettings({ reviewNotifyOnResubmit: "true" }).reviewNotifyOnResubmit).toBe(false);
    expect(parseStaffSettings({ reviewNotifyOnResubmit: true }).reviewNotifyOnResubmit).toBe(true);
    expect(parseStaffSettings({ reviewNotifyOnResubmit: false }).reviewNotifyOnResubmit).toBe(false);
  });
});
