import type { I18n } from "@lingui/core";
import { nationQuestWare } from "@shared/catalog/balance";

import { DAY_MS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { getNationBuildingDefinition } from "../../../render-common/buildings/nation-building-text";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { translateMessage } from "../../../shared/i18n/translate";
import { buildingsUnlockedAt } from "../../../shared/progression/building-unlocks";
import { type DailyQuest, questIsReady } from "../../../shared/progression/daily-quests";
import { questRewardExperience, questRewardGoods } from "../../../shared/progression/quest-rewards";
import type { TalentRanks } from "../../../shared/progression/talents";
import {
  HOME_TUTORIAL_CHAPTER_COUNT, homeChapterSteps, type HomeTutorialQuest
} from "../../../shared/quests/home-quest-book";
import {
  dailyQuestGoal, dailyQuestTitle, homeChapterName, homeQuestCopy, homeQuestTitle
} from "../../../shared/quests/home-quest-text";
import type { TutorialSummary } from "../../../shared/quests/home-quests";
import { getTabIds } from "../../components/helpers";
import { isShallowEqual } from "../../components/ui-store";
import { getSettlementIconSource } from "../icons";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import { progressionIcon } from "../player-hud-helpers";
import {
  displayedRewardEntries, goodsRewardEntries, type RewardDisplayRules, type RewardEntry
} from "../reward-icons/entries";
import { getRewardIconsView } from "../reward-icons/helpers";
import type { SettlementUiOptions, SettlementUiSnapshot } from "../types";
import { reliefQuestDetails, type ReliefQuestUiStatus } from "./relief-helpers";

export const QUEST_DETAILS_ID = "quest-window-details";


const questProgressLabel = (quest: DailyQuest, stored: number, i18n?: I18n) => {
  if (quest.done) return translateMessage(i18n, M.quests.completed);
  if (quest.kind === "produce")
    return translateMessage(i18n, M.quests.produced, { amount: quest.amount, progress: quest.progress });
  return translateMessage(i18n, M.quests.inStorage, {
    amount: quest.amount, stored: Math.min(stored, quest.amount)
  });
};

const questFraction = (quest: DailyQuest, stored: number) => {
  if (quest.done) return 1;
  const value = quest.kind === "deliver" ? stored : quest.progress;
  return Math.min(1, value / Math.max(1, quest.amount));
};


/** Time until the quests renew at UTC midnight (game time). */
const untilMidnight = (now: number, i18n?: I18n) => {
  const midnight = (Math.floor(now / DAY_MS) + 1) * DAY_MS;
  const minutes = Math.max(0, Math.ceil((midnight - now) / 60000));
  return translateMessage(i18n, M.quests.time, {
    hours: Math.floor(minutes / 60), minutes: minutes % 60
  });
};
/** Accessible description for the compact daily-header countdown (UTC midnight). */
const renewText = (open: boolean, now: number, i18n?: I18n) => translateMessage(i18n,
  open ? M.quests.renewOpen : M.quests.renewClosed, { time: untilMidnight(now, i18n) });
export const getQuestCompleted = (i18n?: I18n) => translateMessage(i18n, M.quests.completedStatus);
export const getTutorialSkipped = (i18n?: I18n) => translateMessage(i18n, M.quests.skippedStatus);
export const getQuestConfirming = (i18n?: I18n) => translateMessage(i18n, M.quests.confirming);


/** What the quest book shows: today's open quests, their stored wares and the active tutorial step. */
export interface QuestBook {
  /** False until the first player summary arrives (the window stays empty, as before). */
  loaded: boolean;
  nation: WorkerNation;
  quests: readonly DailyQuest[];
  reliefQuests?: Readonly<Record<string, ReliefQuestUiStatus>>;
  /** Applied talent ranks: the daily quest talent raises the experience shown and paid. */
  talents: TalentRanks;
  /** Compact header countdown and its description; they change once a minute. */
  renewCountdown: string;
  renewText: string;
  /** What the reward chips may name under the island's rules (plan §9.3): nothing with rewards off. */
  rewardDisplay: RewardDisplayRules;
  /** Stored amount of each open quest's ware, in quest order. */
  stored: readonly number[];
  /** Only while a tutorial step is active. */
  tutorial?: TutorialSummary;
}

const NO_TALENTS: TalentRanks = Object.freeze({});
const ALL_REWARDS: RewardDisplayRules = Object.freeze({ experienceRewarded: true, rewardsShown: true });

export const selectQuestBook = ({ player }: SettlementUiSnapshot, i18n?: I18n): QuestBook => {
  const reliefQuests = player?.reliefQuests;
  const quests = (player?.quests ?? []).filter(quest => !quest.done ||
    reliefQuests?.[quest.id]?.stage === "completed");
  return {
    loaded: Boolean(player),
    nation: (player?.nation ?? "roman") as WorkerNation,
    quests,
    reliefQuests,
    renewCountdown: untilMidnight(player?.gameTime ?? 0, i18n),
    renewText: renewText(quests.length > 0, player?.gameTime ?? 0, i18n),
    rewardDisplay: player?.progression ?? ALL_REWARDS,
    talents: player?.talents ?? NO_TALENTS,
    stored: quests.map(quest => player?.stock[quest.ware] ?? 0),
    tutorial: player?.tutorial?.quest ? player.tutorial : undefined
  };
};

const isSameTutorial = (left?: TutorialSummary, right?: TutorialSummary) => {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.quest === right.quest && left.progress === right.progress && left.ready === right.ready &&
    left.enabled === right.enabled && left.skippable === right.skippable;
};

/** The player summary is rebuilt every tick; the book changes only with these values. */
export const isSameQuestBook = (left: QuestBook, right: QuestBook) =>
  left.loaded === right.loaded && left.nation === right.nation && left.renewCountdown === right.renewCountdown &&
  left.renewText === right.renewText && left.talents === right.talents &&
  left.rewardDisplay.rewardsShown === right.rewardDisplay.rewardsShown &&
  left.rewardDisplay.experienceRewarded === right.rewardDisplay.experienceRewarded &&
  isShallowEqual(left.quests, right.quests) && isShallowEqual(left.stored, right.stored) &&
  isSameReliefStatuses(left.reliefQuests, right.reliefQuests) &&
  isSameTutorial(left.tutorial, right.tutorial);

const isSameReliefStatuses = (left: QuestBook["reliefQuests"], right: QuestBook["reliefQuests"]) => {
  if (left === right) return true;
  const ids = Object.keys(left ?? {});
  if (ids.length !== Object.keys(right ?? {}).length) return false;
  return ids.every(id => {
    const a = left![id], b = right?.[id];
    return a && b && a.stage === b.stage && a.loaded === b.loaded && a.departed === b.departed &&
      a.blocker === b.blocker && a.payable === b.payable && a.available === b.available &&
      a.harbourUid === b.harbourUid && a.islandSeed === b.islandSeed;
  });
};

type QuestCategory = "daily" | "tutorial";
export interface QuestSelection {
  category?: QuestCategory;
  id: string;
}

const tutorialId = (book: QuestBook) => book.tutorial?.quest?.id;

/**
 * The selected quest, or its replacement once it left the list: the next tutorial step after a
 * tutorial quest, the first daily quest after a daily one, else the first quest (open selects it).
 */
export const resolveQuestSelection = (book: QuestBook, selection: QuestSelection) => {
  const tutorial = tutorialId(book), daily = book.quests.map(quest => quest.id);
  const ids = [...(tutorial ? [tutorial] : []), ...daily];
  let id = selection.id;
  if (!ids.includes(id)) {
    const replacement = selection.category === "daily" ? daily[0] : tutorial;
    id = replacement ?? ids[0] ?? "";
  }
  const category: QuestCategory = id === tutorial ? "tutorial" : "daily";
  return { category, id };
};

/** Whether the quest book lists this quest now (opener tokens refuse hidden or unknown quests). */
export const isQuestListed = (snapshot: SettlementUiSnapshot, questId: string) => {
  const book = selectQuestBook(snapshot);
  return tutorialId(book) === questId || book.quests.some(quest => quest.id === questId);
};

export type QuestIconSource = { building: number } | { image: string } | { ware: string };

/** Feature tours show the feature's own rendered icon: the talents star and the trade office balance. */
const EVENT_ICONS: Readonly<Record<string, QuestIconSource>> = {
  talent: { image: progressionIcon("level-star") },
  "trade-offer": { image: getSettlementIconSource("market") }
};

const tutorialIcon = (summary: TutorialSummary, nation: WorkerNation): QuestIconSource => {
  const objective = summary.quest!.objective;
  if (objective.kind === "build") return { building: objective.building };
  if (objective.kind === "produce" || objective.kind === "stock" || objective.kind === "deliver")
    return { ware: nationQuestWare(objective.ware, nation) };
  if (objective.kind === "event" && EVENT_ICONS[objective.event]) return EVENT_ICONS[objective.event]!;
  return { ware: "coins" };
};

const tutorialProgress = (summary: TutorialSummary, i18n?: I18n) =>
  translateMessage(i18n, summary.ready ? M.quests.progressReady : M.quests.progress, {
    amount: summary.quest!.objective.amount, progress: summary.progress
  });

/** One quest tab: ids, roving tab index and the ready highlight. */
export interface QuestTab {
  className: string;
  icon: QuestIconSource;
  id: string;
  index: number;
  progressText: string;
  selected: boolean;
  tabId: string;
  tabIndex: number;
  title: string;
}

const entryClassName = (ready: boolean) =>
  ready ? "settlement-ui__tab quest-window__entry is-ready" : "settlement-ui__tab quest-window__entry";

const toTab = (
  fields: Omit<QuestTab, "className" | "selected" | "tabId" | "tabIndex">, ready: boolean, selectedId: string
): QuestTab => ({
  ...fields,
  className: entryClassName(ready),
  selected: fields.id === selectedId,
  tabId: getTabIds("quest-window", fields.id).tabId,
  tabIndex: fields.id === selectedId ? 0 : -1
});

/** The tutorial tab (first) and the daily tabs, in tab order. */
export const getQuestTabs = (book: QuestBook, selectedId: string, i18n?: I18n) => {
  const summary = book.tutorial;
  const tutorial = summary && toTab({ icon: tutorialIcon(summary, book.nation), id: summary.quest!.id, index: 0,
    progressText: tutorialProgress(summary, i18n), title: homeQuestTitle(summary.quest!, book.nation, i18n)
  }, summary.ready, selectedId);
  const offset = tutorial ? 1 : 0;
  const daily = book.quests.map((quest, index) => {
    const relief = reliefQuestDetails(quest, book.reliefQuests?.[quest.id], book.stored[index]!, i18n);
    return toTab({ icon: { ware: quest.ware }, id: quest.id, index: index + offset,
      progressText: relief?.stageLabel ?? questProgressLabel(quest, book.stored[index]!, i18n),
      title: relief?.title ?? dailyQuestTitle(quest, i18n)
    }, relief?.stage === "ready-to-claim" || (!relief && questIsReady(quest, book.stored[index]!)), selectedId);
  });
  const all = [...(tutorial ? [tutorial] : []), ...daily];
  return {
    all, daily,
    orientation: all.length ? "vertical" as const : undefined,
    role: all.length ? "tablist" as const : undefined,
    selectedTabId: all.find(tab => tab.selected)?.tabId,
    tutorial
  };
};

const experienceEntry = (amount: number): RewardEntry => ({ amount, kind: "xp" });

/** The daily quest's experience and goods with the daily quest talent, as signed reward icons. */
const dailyRewards = (
  quest: DailyQuest, { rewardDisplay, talents }: Pick<QuestBook, "rewardDisplay" | "talents">, i18n?: I18n
) => getRewardIconsView(displayedRewardEntries([
  experienceEntry(questRewardExperience(talents, quest.experience)),
  ...goodsRewardEntries(questRewardGoods(talents, quest.reward))
], rewardDisplay), { i18n, signed: true });

const dailyDetails = (
  quest: DailyQuest, stored: number, book: Pick<QuestBook, "rewardDisplay" | "talents">, i18n?: I18n,
  status?: ReliefQuestUiStatus
) => {
  const relief = reliefQuestDetails(quest, status, stored, i18n);
  return {
  claimDisabled: relief?.claimDisabled ?? !questIsReady(quest, stored),
  claimLabel: relief?.claimLabel ?? translateMessage(i18n, quest.kind === "deliver" ? M.quests.deliverAction : M.quests.claim),
  goal: dailyQuestGoal(quest, i18n),
  id: quest.id,
  kind: "daily" as const,
  percent: `${Math.round(questFraction(quest, stored) * 100)}%`,
  progressText: questProgressLabel(quest, stored, i18n),
  rewards: dailyRewards(quest, book, i18n),
  relief,
  title: relief?.title ?? dailyQuestTitle(quest, i18n),
  ware: quest.ware
  };
};

/** "Chapter 3 of 14 · Food from land and sea" and "Step 2 of 5". */
const chapterTexts = (quest: HomeTutorialQuest, i18n?: I18n) => {
  const steps = homeChapterSteps(quest.chapter);
  return {
    chapter: translateMessage(i18n, M.quests.chapter, {
      chapter: quest.chapter, title: homeChapterName(quest.chapter, i18n), total: HOME_TUTORIAL_CHAPTER_COUNT
    }),
    step: translateMessage(i18n, M.quests.step, {
      step: steps.indexOf(quest) + 1, total: steps.length
    })
  };
};

/** What finishing the chapter brings: the next level and the buildings it unlocks. */
const chapterRewardText = (quest: HomeTutorialQuest, nation: WorkerNation, i18n?: I18n) => {
  const level = quest.chapter + 1;
  const names = buildingsUnlockedAt(level).map(type => getNationBuildingDefinition(type, nation).name);
  if (!names.length) return translateMessage(i18n, M.quests.chapterReward, { level });
  return translateMessage(i18n, M.quests.chapterRewardUnlocks, { buildings: names.join(", "), level });
};

/** An optional step says so; a required one is skippable only when its resource is missing. */
const skipLabel = (quest: HomeTutorialQuest, i18n?: I18n) => translateMessage(i18n,
  quest.optional ? M.quests.skipOptional : M.quests.skipMissing);

const tutorialDetails = (
  summary: TutorialSummary, { nation, rewardDisplay }: Pick<QuestBook, "nation" | "rewardDisplay">, i18n?: I18n
) => {
  const quest = summary.quest!;
  const copy = homeQuestCopy(quest, nation, i18n);
  return {
    chapter: chapterTexts(quest, i18n),
    chapterReward: chapterRewardText(quest, nation, i18n),
    claimDisabled: !summary.ready,
    confirming: false,
    icon: tutorialIcon(summary, nation),
    id: quest.id,
    kind: "tutorial" as const,
    notes: [
      { label: translateMessage(i18n, M.quests.why), text: copy.why },
      { label: translateMessage(i18n, M.quests.benefit), text: copy.benefit },
      { label: translateMessage(i18n, M.quests.goodToKnow), text: copy.tips }
    ],
    progressText: tutorialProgress(summary, i18n),
    rewards: getRewardIconsView(
      displayedRewardEntries([experienceEntry(quest.experience)], rewardDisplay), { i18n }),
    showDisabled: !summary.enabled,
    /** Away from home the step is read-only. */
    showHomeNote: !summary.enabled,
    /** A required step whose natural resource the island lacks explains why it may be skipped. */
    showMissingNote: summary.skippable && !quest.optional,
    skipLabel: skipLabel(quest, i18n),
    skippable: summary.skippable,
    title: homeQuestTitle(quest, nation, i18n)
  };
};

export type DailyQuestDetails = ReturnType<typeof dailyDetails>;
export type TutorialQuestDetails = ReturnType<typeof tutorialDetails>;

/**
 * The detail pane of the selected quest; "done" once nothing is left today. A daily quest whose claim waits for
 * the server (`confirmingId`) cannot be claimed a second time meanwhile.
 */
export const getQuestDetails = (
  book: QuestBook, selectedId: string, confirmingId: string | null = null, i18n?: I18n
) => {
  if (book.tutorial && tutorialId(book) === selectedId) {
    const details = tutorialDetails(book.tutorial, book, i18n);
    return confirmingId === selectedId ? { ...details, claimDisabled: true, confirming: true } : details;
  }
  const index = book.quests.findIndex(quest => quest.id === selectedId);
  if (index < 0) return { kind: "done" as const };
  const details = dailyDetails(book.quests[index]!, book.stored[index]!, book, i18n,
    book.reliefQuests?.[selectedId]);
  if (confirmingId !== selectedId) return details;
  return { ...details, claimDisabled: true, claimLabel: getQuestConfirming(i18n) };
};

export type QuestDetails = ReturnType<typeof getQuestDetails>;

type QuestCommands = Pick<SettlementUiOptions, "onCompleteQuest" | "onSkipTutorial">;

/** Claims (or delivers) a quest: true, the refusal reason, "" when unavailable, or the server's pending answer. */
export const completeQuest = ({ onCompleteQuest }: QuestCommands, id: string) => onCompleteQuest?.(id) ?? "";

export const skipTutorialQuest = ({ onSkipTutorial }: QuestCommands, id: string) => onSkipTutorial?.(id) ?? "";
