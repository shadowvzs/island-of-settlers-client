import type { I18n } from "@lingui/core";

import type { QuestText, ScriptQuest } from "../../../../island-of-settlers-shared/src/script/types/index";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { displayQuestText } from "../i18n/quest-text";
import type { DailyQuest } from "../progression/daily-quests";
import { materializeDailyQuest } from "./daily-quest-book";
import { HOME_QUEST_BOOK, homeChapterTitle, type HomeTutorialQuest } from "./home-quest-book";

/**
 * Display texts of the home book's tutorial chain (QU5): resolved from the book through the shared quest text
 * resolver, identical to the former code tutorial texts in every locale and nation (QU3 parity test (b)).
 */
export interface HomeQuestCopy {
  benefit: string;
  tips: string;
  why: string;
}

const resolve = (text: QuestText | null | undefined, i18n?: I18n, nation?: WorkerNation) =>
  text ? displayQuestText(text, i18n, nation ? { nation } : {}) : "";

export const homeQuestTitle = (quest: HomeTutorialQuest, nation: WorkerNation, i18n?: I18n) =>
  resolve(quest.definition.title, i18n, nation);

export const homeQuestCopy = (quest: HomeTutorialQuest, nation: WorkerNation, i18n?: I18n): HomeQuestCopy => ({
  benefit: resolve(quest.definition.details?.benefit, i18n, nation),
  tips: resolve(quest.definition.details?.tips, i18n, nation),
  why: resolve(quest.definition.text, i18n, nation)
});

export const homeChapterName = (chapter: number, i18n?: I18n) => resolve(homeChapterTitle(chapter), i18n);

const dailyQuests = new WeakMap<DailyQuest, ScriptQuest>();

/** The global pool's quest as its home book quest (cached per daily quest object; UI reads it every update). */
const dailyBookQuest = (quest: DailyQuest) => {
  let book = dailyQuests.get(quest);
  if (!book) dailyQuests.set(quest, book = materializeDailyQuest(quest, HOME_QUEST_BOOK.dailyResetUtcMinutes));
  return book;
};

/** "Produce 12 Softwood logs": the ware name is translated with the title (owner 2026-11-11). */
export const dailyQuestTitle = (quest: DailyQuest, i18n?: I18n) => resolve(dailyBookQuest(quest).title, i18n);

export const dailyQuestGoal = (quest: DailyQuest, i18n?: I18n) => resolve(dailyBookQuest(quest).text, i18n);
