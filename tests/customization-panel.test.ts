import { type ComponentProps, createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_CHROME_MESSAGES } from "../src/app/settings/chrome-messages";
import { CustomizationPanelView } from "../src/app/settings/customization/customization-panel";
import { getAvatarGenderOptions } from "../src/app/settings/customization/helpers";
import { CUSTOMIZATION_MESSAGES } from "../src/app/settings/customization/messages";
import { translateMessage } from "../src/shared/i18n/translate";
import { createTestI18n, renderWithI18n } from "./helpers/render-with-i18n";

const renderPanel = (overrides: Partial<ComponentProps<typeof CustomizationPanelView>> = {}) => {
  const i18n = createTestI18n("en");
  const options = getAvatarGenderOptions("nubian", "female", i18n);
  return renderWithI18n(createElement(CustomizationPanelView, {
    changingGender: false,
    changingNation: false,
    genderOptions: options,
    genderStatus: "",
    nation: "nubian",
    nationStatus: "",
    onGenderKey: vi.fn(),
    onGenderSelect: vi.fn(),
    onNationSelect: vi.fn(),
    registerGenderButton: vi.fn(() => vi.fn()),
    ...overrides
  }));
};

describe("customization panel", () => {
  it("renders the shared nation helmets with the localized avatar control", () => {
    const markup = renderPanel();
    expect(markup).toContain('<span class="customization__label">Avatar</span>');
    expect(markup).toContain('<span class="customization__sub-label">Nation</span>');
    expect(markup).toContain('class="race-picker race-picker--large"');
    expect(markup).toContain('aria-checked="true" aria-label="Nubian"');
    expect(markup).toContain('data-nation="roman"');
    expect(markup).toContain('data-nation="viking"');
    expect(markup).toContain('data-nation="japanese"');
  });

  it("renders the male/female face radios with checked state, roving tab index and tooltips", () => {
    const markup = renderPanel();
    expect(markup).toContain('class="customization__gender-options"');
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-labelledby="customization-gender-label"');
    expect(markup).toContain('aria-checked="true" aria-label="Female avatar: Nubian"');
    expect(markup).toContain('aria-checked="false" aria-label="Male avatar: Nubian"');
    expect(markup).toContain('title="Female avatar: Nubian"');
    expect(markup).toContain('title="Male avatar: Nubian"');
    expect(markup).toContain('data-gender="female"');
    expect(markup).toContain('data-gender="male"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup.match(/class="customization__face"/g)).toHaveLength(2);
    expect(markup.match(/alt="" class="customization__face"/g)).toHaveLength(2);
    expect(markup).toContain("nubian-female.webp");
    expect(markup).toContain("nubian-male.webp");
  });

  it("shows only the visible gender captions and the hint", () => {
    const markup = renderPanel();
    expect(markup).toContain(">Female</span>");
    expect(markup).toContain(">Male</span>");
    expect(markup).toContain("The chosen face and body appear on your HUD portrait and when you explore the island.");
  });

  it("exposes the nation and account save status as live status lines", () => {
    const markup = renderPanel({ genderStatus: "Saved on this device only.", nationStatus: "Changing the nation…" });
    expect(markup).toContain('<p class="settings-panel__hint" role="status">Saved on this device only.</p>');
    expect(markup).toContain('<p class="settings-panel__hint" role="status">Changing the nation…</p>');
  });

  it("keeps the first face in the tab order while no gender choice is focused", () => {
    const i18n = createTestI18n("en");
    const options = getAvatarGenderOptions("roman", null, i18n);
    expect(options.map(option => option.tabIndex)).toEqual([0, -1]);
    expect(options.map(option => option.checked)).toEqual([false, false]);
  });

  it("translates the gender group and both accessible face names to Hungarian", () => {
    const i18n = createTestI18n("hu");
    expect(translateMessage(i18n, SETTINGS_CHROME_MESSAGES.window.customization)).toBe("Testreszabás");
    expect(translateMessage(i18n, CUSTOMIZATION_MESSAGES.gender)).toBe("Nem");
    const options = getAvatarGenderOptions("roman", "female", i18n);
    expect(options.map(option => option.label)).toEqual(["Női avatar: Római", "Férfi avatar: Római"]);
  });
});
