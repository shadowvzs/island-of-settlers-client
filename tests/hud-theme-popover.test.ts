import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createExternalStore } from "../src/app/components/ui-store";
import type { HudThemeControls } from "../src/app/hud-theme";
import { getModeOptions, getStyleOptions, type HudThemeChoice, parseHudTheme } from "../src/app/settings/theme/helpers";
import { ThemePopover } from "../src/app/settings/theme/theme-popover";

describe("theme popover helpers", () => {
  it("falls back to light and the current style for missing or unknown stored values", () => {
    expect(parseHudTheme(null, null)).toEqual({ style: "current", theme: "light" });
    expect(parseHudTheme("bogus", "purple")).toEqual({ style: "current", theme: "light" });
    expect(parseHudTheme("vellum", "dark")).toEqual({ style: "vellum", theme: "dark" });
  });

  it("checks exactly the chosen mode and style", () => {
    expect(getModeOptions("dark").map(option => [option.value, option.checked]))
      .toEqual([["light", false], ["dark", true]]);
    const styles = getStyleOptions("bevel");
    expect(styles).toHaveLength(8);
    expect(styles.filter(option => option.checked).map(option => option.value)).toEqual(["bevel"]);
  });
});

describe("theme popover markup", () => {
  it("renders the Mode and Style radio groups with the driver data attributes", () => {
    const controls: HudThemeControls = {
      setStyle: vi.fn(),
      setTheme: vi.fn(),
      store: createExternalStore<HudThemeChoice>({ style: "plaque", theme: "dark" })
    };
    const markup = renderToStaticMarkup(createElement(ThemePopover, { controls }));
    expect(markup).toContain(
      '<div aria-label="Mode" class="hud-theme-popover__group" role="radiogroup"><strong>Mode</strong>'
    );
    expect(markup).toContain('<button aria-checked="true" class="hud-theme-popover__option" data-hud-mode="dark"');
    expect(markup).toContain('<button aria-checked="false" class="hud-theme-popover__option" data-hud-mode="light"');
    expect(markup).toContain('class="hud-theme-popover__mode-icon"');
    expect(markup).toContain(
      '<button aria-checked="true" class="hud-theme-popover__option" data-hud-style-option="plaque" role="radio"'
    );
    expect(markup).toContain(
      '<span class="hud-theme-popover__swatch" data-hud-swatch="plaque"></span>Gold-framed plaque'
    );
  });
});
