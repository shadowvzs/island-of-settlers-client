import { setupI18n } from "@lingui/core";
import { expect, it } from "vitest";

import { levelUpPopup } from "../src/app/settlement-ui/level-up-popup";
import { getQuestTabs, selectQuestBook } from "../src/app/settlement-ui/quests/helpers";
import type { SettlementPlayerSummary } from "../src/app/settlement-ui/types";
import { messages as german } from "../src/locales/de/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { displayTutorialChapter } from "../src/shared/i18n/domain";
import { HOME_TUTORIAL_QUESTS } from "../src/shared/quests/home-quest-book";
import { homeQuestTitle } from "../src/shared/quests/home-quest-text";

/** TRG6 (owner Q1): the quest tab title and the level-up popup's chapter name follow the player's language. */
const LOCALES = [setupI18n({ locale: "hu", messages: { hu: hungarian } }),
  setupI18n({ locale: "de", messages: { de: german } })];
const step = HOME_TUTORIAL_QUESTS.find(quest => quest.id === "talent.apply")!;

it.each(LOCALES)("translates the tutorial tab title and the level-up chapter name (%#)", i18n => {
  const player = { nation: "roman", quests: [], stock: {}, tutorial: { enabled: true, hasNew: false, next: null,
    progress: 0, quest: step, ready: false, skippable: false } } as unknown as SettlementPlayerSummary;
  const title = getQuestTabs(selectQuestBook({ player }, i18n), step.id, i18n).tutorial!.title;
  expect(title).toBe(homeQuestTitle(step, "roman", i18n));
  expect(title).not.toBe(homeQuestTitle(step, "roman"));
  const popup = levelUpPopup([{ coins: 10, gems: 0, level: 2 }], "roman", undefined, i18n);
  expect(popup.message).toContain(displayTutorialChapter(2, i18n));
  expect(popup.message).not.toContain(displayTutorialChapter(2));
});
