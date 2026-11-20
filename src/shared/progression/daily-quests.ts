import {
  DAILY_QUEST_COUNT, dailyQuestGoods, deliveryWaresForLevel, isMaterialAvailable, legacyDeliveryWaresForLevel,
  LEVEL_THRESHOLDS, MAX_PLAYER_LEVEL, nationQuestWare, QUEST_EXPERIENCE_SHARE, QUEST_MINIMUM_EXPERIENCE,
  QUEST_TOOL_BATCH, QUEST_WARE_BATCH, questWaresForLevel
} from "@shared/catalog/balance";

import { isWareAllowedByTier } from
  "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import type { WorkerNation } from "../../render-common/workers/worker-unit";

type QuestKind = "deliver" | "produce";
export interface DailyQuest {
  id: string;
  kind: QuestKind;
  ware: string;
  amount: number;
  /** Produced so far (produce quests); deliver quests are paid in one go. */
  progress: number;
  experience: number;
  /** Goods paid on claiming (coins and a building material bundle), before the quest talent. */
  reward: Readonly<Record<string, number>>;
  done: boolean;
}

export interface DailyQuestCapabilities {
  /** Runtime supplies actual owned, completed harbour availability; omitted by legacy pure callers. */
  reliefAvailable: boolean;
  /** The home island's highest material tier (MAP BUILDING AVAILABILITY); absent = every tier. */
  tierCap?: number;
}

/** Cached per player level: quest refreshes run on every produced ware. */
const deliverableSets = new Map<number, ReadonlySet<string>>();
const deliverableWareSet = (level: number) => {
  const band = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(level)));
  let wares = deliverableSets.get(band);
  // Preserve already saved quests under the existing tier-retirement policy. New donation exclusions
  // affect generation only, never today's persisted request or reward.
  if (!wares) deliverableSets.set(band, wares = new Set(legacyDeliveryWaresForLevel(level)));
  return wares;
};

const batchFactor = (ware: string, toolWares: ReadonlySet<string>) =>
  QUEST_WARE_BATCH[ware] ?? (toolWares.has(ware) ? QUEST_TOOL_BATCH : 1);

/** Amount grows with level; experience is a share of the current level's step. */
export const questAmount = (ware: string, level: number, toolWares: ReadonlySet<string> = new Set()) =>
  Math.max(2, Math.round((6 + level * 1.5) * batchFactor(ware, toolWares)));

export const questExperience = (level: number) => {
  const step = level >= MAX_PLAYER_LEVEL ? 0 : LEVEL_THRESHOLDS[level]! - LEVEL_THRESHOLDS[level - 1]!;
  return Math.max(QUEST_MINIMUM_EXPERIENCE, Math.round(step * QUEST_EXPERIENCE_SHARE));
};

/** Donation reward uses the full generation-level step, independent of current XP within it. */
export const deliveryQuestExperience = (level: number) => level >= MAX_PLAYER_LEVEL ? 0 :
  Math.round((LEVEL_THRESHOLDS[level]! - LEVEL_THRESHOLDS[level - 1]!) * .05);

const hash = (text: string) => {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
};

/** The day's one quest: random production or delivery when its runtime capability allows delivery. */
const dailyQuestKind = (canDeliver: boolean, deliver: boolean): QuestKind =>
  canDeliver && deliver ? "deliver" : "produce";

/** Older quests of another nation's drink chain become this nation's; same array when unchanged. */
export const migrateNationQuests = (quests: DailyQuest[], nation: WorkerNation = "roman"): DailyQuest[] => {
  if (quests.every(quest => nationQuestWare(quest.ware, nation) === quest.ware)) return quests;
  return quests.map(quest => ({ ...quest, ware: nationQuestWare(quest.ware, nation) }));
};

/**
 * The day's quest (DAILY_QUEST_COUNT, one since 2026-10-20): completed-harbour capability enables
 * relief at any level; legacy pure callers retain the level10 gate. It pays experience and goods.
 */
export const generateDailyQuests = (
  day: string, level: number, seed: number, toolWares: ReadonlySet<string> = new Set(),
  nation: WorkerNation = "roman", capabilities?: DailyQuestCapabilities
): DailyQuest[] => {
  let state = hash(`${day}:${seed}:${level}`);
  const roll = (range: number) => { state = Math.imul(state ^ (state >>> 13), 1274126177) >>> 0; return state % range; };
  const tierRules = { tier: capabilities?.tierCap };
  const wares = questWaresForLevel(level).filter(ware => isWareAllowedByTier(tierRules, ware));
  const deliverable = new Set(deliveryWaresForLevel(level, capabilities?.reliefAvailable));
  const kinds = Array.from({ length: DAILY_QUEST_COUNT }, () => dailyQuestKind(deliverable.size > 0, roll(2) === 1));
  const pickWare = (kind: QuestKind) => {
    const candidates = kind === "deliver" ? wares.filter(ware => deliverable.has(ware)) : wares;
    if (!candidates.length) return undefined;
    const ware = candidates[roll(candidates.length)]!;
    wares.splice(wares.indexOf(ware), 1);
    return ware;
  };
  return kinds.flatMap((kind, index) => {
    const ware = pickWare(kind);
    if (ware === undefined) return [];
    return [{ amount: kind === "deliver" ? Math.floor(level / 2) + roll(5) + 1 : questAmount(ware, level, toolWares),
      done: false, experience: kind === "deliver" ? deliveryQuestExperience(level) : questExperience(level),
      id: `${day}-${index}`, kind, progress: 0, reward: dailyQuestGoods(level, ware), ware: nationQuestWare(ware, nation) }];
  });
};

const isRetiredDelivery = (quest: DailyQuest, deliverable: ReadonlySet<string>, level: number) =>
  isMaterialAvailable(quest.ware, level) && !quest.done && quest.kind === "deliver" && !deliverable.has(nationQuestWare(quest.ware));

/**
 * Saves made before the early delivery quests were removed may hold one (e.g. deliver 8 logs at
 * level 1): it becomes the production quest for the same ware and amount. Returns the same array
 * when nothing changes.
 */
export const migrateRetiredQuests = (quests: DailyQuest[], level: number): DailyQuest[] => {
  if (!quests.some(quest => quest.kind === "deliver" && !quest.done)) return quests;
  const deliverable = deliverableWareSet(level);
  if (!quests.some(quest => isRetiredDelivery(quest, deliverable, level))) return quests;
  return quests.map(quest => isRetiredDelivery(quest, deliverable, level)
    ? { ...quest, kind: "produce" as const, progress: 0 } : quest);
};

/** Ready to hand in: delivery quests count this island's stock, production quests their progress. */
export const questIsReady = (quest: DailyQuest, stored: number) =>
  !quest.done && (quest.kind === "deliver" ? stored >= quest.amount : quest.progress >= quest.amount);

/** Claimed quests leave the quest list until the next day's quests arrive. */
export const activeQuests = (quests: readonly DailyQuest[]) => quests.filter(quest => !quest.done);

export const claimableQuestCount = (quests: readonly DailyQuest[], stock: Readonly<Record<string, number>>) =>
  quests.filter(quest => questIsReady(quest, stock[quest.ware] ?? 0)).length;
