import { splitContentId, toContentId } from "@shared/catalog";

import type {
  QuestObjective, QuestRewards, QuestText, ScriptQuest, ScriptRef
} from "../../../../island-of-settlers-shared/src/script/types/index";
import type { DailyQuest } from "../progression/daily-quests";
import { COINS_WARE, DAILY_QUEST_ID_PREFIX, DAILY_QUEST_TEXTS } from "./constants";

/**
 * The generated global daily pool as unified quests (QU §6, trigger design §4.10): a quest of the pool becomes a
 * `ScriptQuest` with a daily calendar repeat, so the engine, quest window and claim route can treat it like a map
 * quest. The pool itself stays generated (`generateDailyQuests`); a quest book only switches it on (`daily`).
 */
export type DailyQuestDefinition = Omit<DailyQuest, "done" | "progress">;

const wareRef = (ware: string): ScriptRef<"content"> => ({ id: toContentId("ware", ware), k: "ref", kind: "content" });

/** Coins are their own reward field; every other paid ware is a goods line, in ware order. */
const toHomeReward = (quest: DailyQuestDefinition): QuestRewards => ({
  buildingUnlocks: [],
  coins: quest.reward[COINS_WARE] ?? 0,
  decorations: [],
  gems: 0,
  goods: Object.entries(quest.reward).filter(([ware]) => ware !== COINS_WARE)
    .map(([ware, amount]) => ({ amount, ware })).sort((first, second) => first.ware.localeCompare(second.ware, "en")),
  xp: quest.experience
});

/** Production counts what is made after the quest arrives; a delivery checks the stock and takes the wares. */
const toObjective = (quest: DailyQuestDefinition): QuestObjective => {
  const ware = wareRef(quest.ware);
  if (quest.kind === "deliver") return { amount: quest.amount, kind: "stockLevel", ware };
  return { amount: quest.amount, kind: "wareProduced", since: "activation", ware };
};

const toTitle = (quest: DailyQuestDefinition): QuestText => ({
  ...DAILY_QUEST_TEXTS[quest.kind].title,
  values: {
    count: { kind: "number", value: quest.amount },
    wares: { content: wareRef(quest.ware), form: "counted", kind: "content" }
  }
});

/** One quest of the day's pool as a unified quest that resets at `dailyResetUtcMinutes` of its book. */
export const materializeDailyQuest = (quest: DailyQuestDefinition, dailyResetUtcMinutes: number): ScriptQuest => ({
  cost: quest.kind === "deliver" ? [{ amount: quest.amount, ware: quest.ware }] : [],
  deadline: null,
  failure: null,
  groupId: null,
  homeReward: toHomeReward(quest),
  id: `${DAILY_QUEST_ID_PREFIX}${quest.id}`,
  objective: toObjective(quest),
  onActivate: [],
  onFailure: [],
  onSuccess: [],
  repeat: { kind: "calendar", minuteUtc: dailyResetUtcMinutes, retryAfterFail: false },
  text: DAILY_QUEST_TEXTS[quest.kind].goal,
  title: toTitle(quest),
  visibility: "visible"
});

export const isMaterializedDailyQuest = (quest: ScriptQuest) => quest.id.startsWith(DAILY_QUEST_ID_PREFIX);

const objectiveWare = (quest: ScriptQuest) => {
  const { objective } = quest;
  if (objective.kind !== "stockLevel" && objective.kind !== "wareProduced")
    throw new Error(`Quest ${quest.id} is not a daily pool quest (${objective.kind})`);
  return { amount: objective.amount, ware: splitContentId(objective.ware.id)!.key };
};

/** The pool quest a materialized daily quest stands for (the daily ledger id, kind, ware, amount and rewards). */
export const dailyQuestOf = (quest: ScriptQuest): DailyQuestDefinition => {
  const reward = quest.homeReward;
  return {
    ...objectiveWare(quest),
    experience: reward?.xp ?? 0,
    id: quest.id.slice(DAILY_QUEST_ID_PREFIX.length),
    kind: quest.cost.length ? "deliver" : "produce",
    reward: {
      ...(reward?.coins ? { [COINS_WARE]: reward.coins } : {}),
      ...Object.fromEntries((reward?.goods ?? []).map(({ amount, ware }) => [ware, amount]))
    }
  };
};
