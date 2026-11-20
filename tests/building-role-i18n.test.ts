import { setupI18n } from "@lingui/core";
import { buildingByKey } from "@shared/catalog";
import { buildingRoleText, buildingsWithRules } from "@shared/catalog/building-data/rules";
import { describe, expect, it } from "vitest";

import {
  getBuildingCardGroups, getSelectionDetail, selectBuildingPicker
} from "../src/app/settlement-ui/main-panel/build-helpers";
import { messages as german } from "../src/locales/de/messages";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { displayBuildingRole } from "../src/shared/i18n/building-role";

/** Owner answer 58 (content catalog plan): building role texts carry translation keys and ship in en/hu/de. */
const ENGLISH = setupI18n({ locale: "en", messages: { en: english } });
const TRANSLATED = [setupI18n({ locale: "hu", messages: { hu: hungarian } }),
  setupI18n({ locale: "de", messages: { de: german } })];
const SAWMILL = buildingByKey("sawmill")!.code;

/** Every shown role: each active building for no nation and for every nation that overrides its role. */
const ROLE_CASES = buildingsWithRules().flatMap(({ entry, rules }) => [
  { code: entry.code, label: entry.key, nation: undefined as string | undefined },
  ...Object.entries(rules.nations ?? {}).filter(([, variant]) => variant.role)
    .map(([nation]) => ({ code: entry.code, label: `${entry.key}.${nation}`, nation }))
]);

describe("building role texts", () => {
  it("covers every active building and the nation drink chain variants", () => {
    expect(ROLE_CASES.length).toBeGreaterThan(buildingsWithRules().length);
    for (const { code, label, nation } of ROLE_CASES)
      expect(buildingRoleText(code, nation)?.key, label).toMatch(/^content\.building\.[A-Za-z]+\.role(\.[a-z]+)?$/);
  });

  it("resolves to the catalog's English source in English", () => {
    for (const { code, label, nation } of ROLE_CASES) {
      const english = buildingRoleText(code, nation)!.en;
      expect(displayBuildingRole(code, nation, ENGLISH), label).toBe(english);
      expect(displayBuildingRole(code, nation), label).toBe(english);
    }
  });

  it.each(TRANSLATED)("has its own translation without an English fallback (%#)", i18n => {
    for (const { code, label, nation } of ROLE_CASES) {
      const { en, key } = buildingRoleText(code, nation)!;
      const shown = displayBuildingRole(code, nation, i18n);
      expect(i18n.messages[key], label).toBeTruthy();
      expect(shown, label).not.toBe(en);
      expect(shown, label).not.toBe(key);
    }
  });

  it("keeps the nation override apart from the shared role and ignores nations without one", () => {
    const winery = ROLE_CASES.find(item => item.label === "winery.viking")!;
    expect(displayBuildingRole(winery.code, "viking")).toBe("Brews honey into mead");
    expect(displayBuildingRole(winery.code, "roman")).toBe("Presses grapes into wine");
    expect(displayBuildingRole(-1)).toBe("");
  });

  it.each(TRANSLATED)("shows the translated role on the build card and in the selection line (%#)", i18n => {
    const picker = selectBuildingPicker({ selectedBuilding: SAWMILL });
    const role = displayBuildingRole(SAWMILL, picker.nation, i18n);
    const card = getBuildingCardGroups(picker, i18n).flatMap(group => group.cards).find(item => item.id === SAWMILL)!;
    expect(card.description).toBe(role);
    expect(card.title).toContain(role);
    expect(getSelectionDetail(picker, null, i18n)).toContain(role);
    expect(getSelectionDetail(picker, null, i18n)).not.toContain("Saws logs into boards");
  });
});
