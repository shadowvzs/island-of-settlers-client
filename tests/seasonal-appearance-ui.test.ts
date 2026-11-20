import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { globalAppearanceSections } from "../src/app/settings/development/helpers";
import { GlobalSeasonSection, GlobalSeasonView } from
  "../src/app/settings/seasonal-appearance/global-season-section";
import { SeasonalAppearanceSection } from "../src/app/settings/seasonal-appearance/seasonal-appearance-section";
import { seasonalAppearance } from "../src/app/settings/seasonal-appearance/store";
import { renderWithI18n } from "./helpers/render-with-i18n";

describe("seasonal appearance controls", () => {
  it("adds the server-wide action only for a verified administrator", () => {
    expect(globalAppearanceSections(undefined)).toEqual([]);
    expect(globalAppearanceSections(false)).toEqual([]);
    expect(globalAppearanceSections(true)).toEqual([{ kind: "global-appearance" }]);
  });
  it("gives every player a captionless compact season opt-out with a clear yes/no state", () => {
    seasonalAppearance.setIgnoreGlobalWinter(false);
    const markup = renderWithI18n(createElement(SeasonalAppearanceSection));
    expect(markup).toContain('aria-label="Ignore global season"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('title="Ignore global season: No"');
    expect(markup).toContain("settlement-ui__icon-button--compact");
    expect(markup).not.toContain("<span>");
    seasonalAppearance.setIgnoreGlobalWinter(true);
    const ignored = renderWithI18n(createElement(SeasonalAppearanceSection));
    expect(ignored).toContain('aria-pressed="true"');
    expect(ignored).toContain('title="Ignore global season: Yes"');
    seasonalAppearance.setIgnoreGlobalWinter(false);
  });

  it("shows the admin season mode, fixed season and duration, and the offline hint", () => {
    const admin = renderWithI18n(createElement(GlobalSeasonSection));
    expect(admin).toContain('aria-label="Season mode"');
    expect(admin).toContain('aria-label="Fixed season"');
    expect(admin).toContain('aria-label="Change duration"');
    expect(admin).toContain("Four seasons");
    expect(admin).toContain("Sign in to the online service to change the global season.");
  });

  it("exposes save failures as alerts", () => {
    const markup = renderWithI18n(createElement(GlobalSeasonView, {
      error: "The season could not be saved. Try again.", fixedSeason: "autumn", fixedSeasonHint: "hint",
      fixedSeasonLabel: "Fixed season", hint: "hint", mode: "none", modeChoices: [{ label: "None", value: "none" }],
      modeLabel: "Season mode", seasonChoices: [{ label: "Autumn", value: "autumn" }], status: "Saving…",
      title: "Global season", transitionChoices: [{ label: "3 minutes", value: 180 }], transitionLabel: "Duration",
      transitionSeconds: 180, onFixedSeasonChange: vi.fn(), onModeChange: vi.fn(), onTransitionChange: vi.fn()
    }));
    expect(markup).toContain('aria-live="polite" class="settings-panel__hint">Saving…');
    expect(markup).toContain('<p role="alert">The season could not be saved. Try again.</p>');
  });
});
