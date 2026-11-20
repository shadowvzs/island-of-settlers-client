import { getContentEntry, splitContentId } from "@shared/catalog";

import type {
  QuestBook, QuestObjective, ScriptQuest, ScriptRef
} from "../../../../island-of-settlers-shared/src/script/types/index";
import type { TutorialQuest } from "./home-quest-types";
import { TUTORIAL_CHAPTER_GROUP_PREFIX } from "./constants";

/**
 * The tutorial read back from a home quest book (QU3): the facts of each step that the tutorial chain needs
 * (id, order, chapter, objective, XP, optional, resource). Texts stay in the book and are resolved for display.
 */
export type TutorialQuestFacts = Pick<TutorialQuest, "chapter" | "experience" | "id" | "objective" | "optional" |
  "resource">;

export const tutorialChapterGroupId = (chapter: number) => `${TUTORIAL_CHAPTER_GROUP_PREFIX}${chapter}`;

const contentKey = (ref: ScriptRef<"content">) => {
  const parts = splitContentId(ref.id);
  if (!parts) throw new Error(`Malformed content id ${ref.id}`);
  return parts.key;
};

const buildingType = (ref: ScriptRef<"content">) => {
  const code = getContentEntry(ref.id)?.code;
  if (code === undefined) throw new Error(`Unknown building ${ref.id}`);
  return code;
};

const toTutorialObjective = (objective: QuestObjective, questId: string): TutorialQuest["objective"] => {
  if (objective.kind === "buildingCompleted")
    return { amount: objective.count, building: buildingType(objective.building), kind: "build" };
  if (objective.kind === "wareProduced")
    return { amount: objective.amount, kind: "produce", ware: contentKey(objective.ware) };
  if (objective.kind === "actionPerformed")
    return { amount: objective.count, event: objective.action, kind: "event",
      ...(objective.since === "ever" ? { countsBeforeUnlock: true } : {}) };
  if (objective.kind === "stockLevel" && objective.building)
    return { amount: objective.amount, building: buildingType(objective.building), kind: "stock",
      ware: contentKey(objective.ware) };
  if (objective.kind === "stockLevel")
    return { amount: objective.amount, kind: "deliver", ware: contentKey(objective.ware) };
  if (objective.kind === "soldierCount" && objective.stationed)
    return { amount: objective.count, kind: "garrison",
      ...(objective.soldierType ? { troop: contentKey(objective.soldierType) } : {}) };
  throw new Error(`Quest ${questId} has no tutorial objective (${objective.kind})`);
};

const toTutorialQuest = (quest: ScriptQuest, chapter: number): TutorialQuestFacts => ({
  chapter,
  experience: quest.homeReward?.xp ?? 0,
  id: quest.id,
  objective: toTutorialObjective(quest.objective, quest.id),
  ...(quest.optional ? { optional: true } : {}),
  ...(quest.skippableWhen ? { resource: quest.skippableWhen.resource } : {})
});

/** The book's chapter quests in book order; the chapter is the player level that unlocks the quest's group. */
export const bookToTutorialQuests = (book: QuestBook): TutorialQuestFacts[] => {
  const chapterByGroup = new Map<string, number>();
  for (const group of book.groups)
    if (group.id.startsWith(TUTORIAL_CHAPTER_GROUP_PREFIX) && group.unlock) chapterByGroup.set(group.id,
      group.unlock.level);
  return book.quests.flatMap(quest => {
    const chapter = quest.groupId ? chapterByGroup.get(quest.groupId) : undefined;
    return chapter === undefined ? [] : [toTutorialQuest(quest, chapter)];
  });
};
