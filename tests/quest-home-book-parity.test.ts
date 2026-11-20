import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";

import { NATIONS } from "../../island-of-settlers-shared/src/nations";
import { defaultHomeQuestBook } from "../../island-of-settlers-shared/src/script/books/index";
import type { QuestText, ScriptQuest } from "../../island-of-settlers-shared/src/script/types/index";
import { messages as german } from "../src/locales/de/messages";
import { messages as english } from "../src/locales/en/messages";
import { messages as hungarian } from "../src/locales/hu/messages";
import { displayQuestText } from "../src/shared/i18n/quest-text";
import { tutorialChapterGroupId } from "../src/shared/quests/home-book-tutorial";

const BOOK_FILE = fileURLToPath(
  new URL("../../island-of-settlers-shared/src/script/books/home-default.json", import.meta.url));
const MAX_BOOK_BYTES = 512 * 1024;
const ENGLISH = setupI18n({ locale: "en", messages: { en: english } });
const HUNGARIAN = setupI18n({ locale: "hu", messages: { hu: hungarian } });
const GERMAN = setupI18n({ locale: "de", messages: { de: german } });

const book = defaultHomeQuestBook();
const textOf = (quest: ScriptQuest): readonly QuestText[] =>
  [quest.title!, quest.text!, quest.details!.benefit!, quest.details!.tips!].filter((text): text is QuestText => !!text);
const allTexts = [...book.groups.map(group => group.title), ...book.quests.flatMap(textOf)];

describe("default home quest book", () => {
  it("unlocks chapter N at player level N, after chapter N - 1, with the level top-up", () => {
    book.groups.forEach((group, index) => {
      const chapter = index + 1;
      expect(group).toMatchObject({
        activation: "sequential",
        completionTopUp: "nextLevel",
        id: tutorialChapterGroupId(chapter),
        requiresGroups: chapter > 1 ? [tutorialChapterGroupId(chapter - 1)] : [],
        unlock: { kind: "playerLevel", level: chapter }
      });
    });
  });

  it("ends each group with exactly one quest and pays XP only, once", () => {
    const lastOfGroup = new Map(book.quests.map(quest => [quest.groupId, quest.id]));
    for (const group of book.groups) expect(lastOfGroup.has(group.id)).toBe(true);
    for (const quest of book.quests) {
      expect(quest).toMatchObject({ deadline: null, failure: null, onActivate: [], onFailure: [],
        onSuccess: [], repeat: { kind: "once", retryAfterFail: false }, visibility: "visible" });
      expect(quest.homeReward).toEqual({ buildingUnlocks: [], coins: 0, decorations: [], gems: 0, goods: [],
        xp: quest.homeReward!.xp });
      expect(quest.mapReward).toBeUndefined();
    }
  });

  it.each(NATIONS)("shows every chapter and step text of the %s tutorial in en, hu and de", nation => {
    const viewer = { nation };
    for (const i18n of [ENGLISH, HUNGARIAN, GERMAN]) {
      for (const group of book.groups) expect(displayQuestText(group.title, i18n, viewer)).not.toBe("");
      for (const quest of book.quests)
        for (const text of textOf(quest)) expect(displayQuestText(text, i18n, viewer)).not.toBe("");
    }
  });

  it("keeps the established Lingui ids in all three catalogs", () => {
    for (const text of allTexts) {
      expect(text.translationKey).toMatch(/^domain\.tutorial\./);
      for (const messages of [english, hungarian, german]) expect(messages).toHaveProperty([text.translationKey!]);
    }
  });

  it("stores the English catalog's text as the inline English", () => {
    for (const text of allTexts) {
      const { en, ...withoutEnglish } = text;
      expect(displayQuestText({ ...withoutEnglish, en: " " }, ENGLISH), en).toBe(displayQuestText(text, ENGLISH));
    }
  });

  it("is small enough to ship in the map header", () => {
    expect(Buffer.byteLength(readFileSync(BOOK_FILE))).toBeLessThanOrEqual(MAX_BOOK_BYTES);
  });
});
