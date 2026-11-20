import { defaultHomeQuestBook } from "../../../../island-of-settlers-shared/src/script/books/index";
import type { QuestText, ScriptQuest } from "../../../../island-of-settlers-shared/src/script/types/index";
import { bookToTutorialQuests, tutorialChapterGroupId,type TutorialQuestFacts } from "./home-book-tutorial";

/**
 * The home island's quest book at run time (QU5, lane TRG6): the default home book (`home-default`), read once
 * into the tutorial chain the quest window, HUD and navigation show. Every entry keeps its book quest, whose texts
 * are resolved for display; the chain order, chapters, objectives and XP come from the book alone.
 */
export interface HomeTutorialQuest extends TutorialQuestFacts {
  /** The book quest (texts, objective, rewards, skip rule). */
  readonly definition: ScriptQuest;
}

export const HOME_QUEST_BOOK = defaultHomeQuestBook();

const questById = new Map(HOME_QUEST_BOOK.quests.map(quest => [quest.id, quest]));

/** The chain in book order (frozen entries, so identity comparisons hold across summaries). */
export const HOME_TUTORIAL_QUESTS: readonly HomeTutorialQuest[] = Object.freeze(
  bookToTutorialQuests(HOME_QUEST_BOOK).map(facts => Object.freeze({ ...facts, definition: questById.get(facts.id)! })));

const tutorialById = new Map(HOME_TUTORIAL_QUESTS.map(quest => [quest.id, quest]));

const stepsByChapter = new Map<number, readonly HomeTutorialQuest[]>();
for (const quest of HOME_TUTORIAL_QUESTS)
  stepsByChapter.set(quest.chapter, [...(stepsByChapter.get(quest.chapter) ?? []), quest]);

export const HOME_TUTORIAL_CHAPTER_COUNT = HOME_TUTORIAL_QUESTS.at(-1)!.chapter;

export const homeTutorialQuest = (id: string | null | undefined) => (id ? tutorialById.get(id) : undefined);

export const isHomeTutorialQuest = (id: string) => tutorialById.has(id);

/** The steps of one chapter, in order. */
export const homeChapterSteps = (chapter: number): readonly HomeTutorialQuest[] => stepsByChapter.get(chapter) ?? [];

const chapterTitles = new Map(HOME_QUEST_BOOK.groups.map(group => [group.id, group.title]));

/** The chapter's title text (the book group of the chapter). */
export const homeChapterTitle = (chapter: number): QuestText | undefined =>
  chapterTitles.get(tutorialChapterGroupId(chapter));

/** The global daily pool is switched on by the home book (`daily: "global"`). */
export const homeDailyPoolEnabled = () => HOME_QUEST_BOOK.daily === "global";
