import { type I18n, setupI18n } from "@lingui/core";
import { buildingEntries, soldierEntries, wareEntries } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import type { QuestText } from "../../island-of-settlers-shared/src/script/types/quest-text";
import { messages as german } from "../src/locales/de/messages";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { displayBuildingNameForCount, displayTroopName, formatDomainWareCount } from "../src/shared/i18n/domain";
import { displayQuestText, questTextContext } from "../src/shared/i18n/quest-text";
import type { MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";

/** QU2: quest texts of map data through the real en/hu/de catalogs, and the catalog name bridge. */

const LOCALES: Readonly<Record<string, I18n>> = {
  de: setupI18n({ locale: "de", messages: { de: german } }),
  en: setupI18n({ locale: "en", messages: { en: english } }),
  hu: setupI18n({ locale: "hu", messages: { hu: hungarian } })
};
const content = (id: string, form: "name" | "plural" | "counted") =>
  ({ content: { id, k: "ref" as const, kind: "content" as const }, form, kind: "content" as const });
const COUNTS = [1, 2, 5, 1200];

describe("quest text resolver with the Lingui catalogs", () => {
  const shipped: QuestText = { en: "Timber", translationKey: "domain.tutorial.chapter.1" };

  it("uses inline text of the language first, then the catalog id, then inline English", () => {
    expect(displayQuestText({ ...shipped, hu: "Helyi cím" }, LOCALES.hu)).toBe("Helyi cím");
    expect(displayQuestText(shipped, LOCALES.hu)).toBe(LOCALES.hu!._("domain.tutorial.chapter.1"));
    expect(displayQuestText(shipped, LOCALES.hu)).not.toBe("Timber");
    expect(displayQuestText(shipped, LOCALES.de)).toBe(LOCALES.de!._("domain.tutorial.chapter.1"));
    expect(displayQuestText({ en: "Timber", translationKey: "quest.not.in.catalog" }, LOCALES.hu)).toBe("Timber");
    expect(displayQuestText({ en: "Only English" }, LOCALES.de)).toBe("Only English");
  });

  it("keeps an edited English text in English and falls back to English without a catalog", () => {
    expect(displayQuestText({ ...shipped, en: "Lumber" }, LOCALES.en)).toBe("Lumber");
    expect(displayQuestText(shipped)).toBe("Timber");
    expect(questTextContext().locale).toBe("en");
  });

  it("fills typed values in every language like the existing title template", () => {
    const title: QuestText = { en: "Produce {count} {ware}", translationKey: "domain.tutorial.template.produce",
      values: { count: { kind: "number", value: 3 }, ware: content("ware:sword", "plural") } };
    expect(displayQuestText(title, LOCALES.en)).toBe("Produce 3 Swords");
    for (const i18n of Object.values(LOCALES)) {
      const ware = LOCALES[i18n.locale]!._({ id: "domain.wareCount.sword", values: { count: 3 } });
      expect(displayQuestText(title, i18n))
        .toBe(i18n._({ id: "domain.tutorial.template.produce", values: { count: 3, ware } }));
    }
  });
});

describe("catalog name bridge", () => {
  it("names every ware, building and troop for every nation and count in en, hu and de", () => {
    for (const i18n of [undefined, ...Object.values(LOCALES)]) for (const count of COUNTS) {
      for (const ware of wareEntries()) {
        const text: QuestText = { en: "{wares}", values: { count: { kind: "number", value: count },
          wares: content(ware.id, "counted") } };
        expect(displayQuestText(text, i18n)).toBe(formatDomainWareCount(ware.key, count, i18n));
      }
      for (const nation of NATIONS) {
        for (const building of buildingEntries()) {
          const text: QuestText = { en: "{building}", values: { building: content(building.id, "plural"),
            count: { kind: "number", value: count } } };
          expect(displayQuestText(text, i18n, { nation }))
            .toBe(displayBuildingNameForCount(building.code!, count, nation, i18n));
        }
        for (const soldier of soldierEntries()) {
          const text: QuestText = { en: "{troop}", values: { count: { kind: "number", value: count },
            troop: content(soldier.id, "plural") } };
          expect(displayQuestText(text, i18n, { nation }))
            .toBe(displayTroopName(nation, soldier.key as MilitaryTroopType, count !== 1, i18n));
        }
      }
    }
  });

  it("keeps the established names", () => {
    expect(formatDomainWareCount("sword", 1200)).toBe("1,200 Swords");
    expect(displayBuildingNameForCount(17, 2, "roman")).toBe("Woodcutters");
    expect(displayBuildingNameForCount(17, 2, "roman", LOCALES.hu)).toBe(LOCALES.hu!._("domain.building.woodcutter"));
    expect(displayTroopName("viking", "shield", true)).toBe("Shield warriors");
    expect(displayTroopName("unknown-nation", "shield")).toBe("Swordsman");
  });
});
