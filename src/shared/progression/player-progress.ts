import { levelForExperience, levelUpReward, MAX_PLAYER_LEVEL } from "@shared/catalog/balance";

import { type PlayerInventory, validPlayerInventory } from "../../../../island-of-settlers-shared/src/player-inventory";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { type LocalCampaignVictories, validLocalCampaignVictories } from "../campaign/campaign-victory-reward";
import { type LocalCampaignProgress, validLocalCampaignProgress } from "../campaign/local-campaign-progress";
import { migrateLegacyTutorial, validHomeQuestProgress } from "../quests/home-quest-save";
import type { HomeQuestProgress } from "../quests/home-quests";
import {
type DailyQuest, type DailyQuestCapabilities,
  generateDailyQuests, migrateNationQuests, migrateRetiredQuests} from "./daily-quests";
import { type InboxMail, validInboxMails } from "./inbox-mails";
import { monumentExperience } from "./monument-bonus";
import { questRewardExperience, questRewardGoods } from "./quest-rewards";
import { canClaimReliefQuest, completeReliefQuest, isReliefQuest, registerReliefQuests,
  type ReliefQuestState, retainedReliefQuestIds, validateReliefQuestState } from "./relief-quests";
import { type TalentRanks, talentRanksError } from "./talents";

/** Player-wide progress: shared by every island and carried when travelling. */
export interface CommanderOwner {
  /** Stable commander identity; the island's military save owns its live soldier state. */
  id: string;
  /** Seed of the island where the commander was recruited. */
  homeIslandSeed: number;
}
export interface PlayerProgress {
  version: 1;
  /** Campaign progress of a slot without a server (no-home play, GS3a): completed maps with their exits. */
  campaignProgress?: LocalCampaignProgress;
  /** A guest's paid campaign victories (C12; signed-in players: the server's ledger); absent = none. */
  campaignVictories?: LocalCampaignVictories;
  /** One player-wide commander ownership marker; more roster slots are a later expansion. */
  commander?: CommanderOwner;
  messages?: readonly InboxMail[];
  /**
   * The home island's quest book state (the default home book's tutorial chain, QU5); saves without one start it
   * when the home island binds. Replaces the code tutorial's `tutorial` field (migrated loss-free on load).
   */
  questBook?: HomeQuestProgress;
  /** Seeds the daily quests; fixed at creation so every island offers the same quests. */
  seed: number;
  experience: number;
  /**
   * A completed Monument stands on the home island (owner 2026-11-10): +25 % experience and the harbour
   * defenders of new colony/campaign starts. Kept in step by the home island's player session; absent = none.
   */
  homeMonument?: true;
  /** Premium currency; never a ware and never stored on an island. */
  gems: number;
  /** Personal consumables, never warehouse goods; absent means an empty inventory. */
  inventory?: PlayerInventory;
  questDay: string;
  questSeenDay?: string;
  quests: DailyQuest[];
  /** New relief identities and their physical fulfillment receipts; absent on legacy saves. */
  relief?: ReliefQuestState;
  /** Applied talent ranks (TALENT-01); talents without points are absent. */
  talents: TalentRanks;
}
export interface LevelUp { level: number; coins: number; gems: number }

export const createPlayerProgress = (seed: number): PlayerProgress => ({
  experience: 0, gems: 0, questDay: "", quests: [], seed: seed >>> 0, talents: {}, version: 1
});

/**
 * Fields of retired features, dropped on load: the weekly coastal defence (POLICY-01, 2026-10-19) and
 * the Temple's blessing scrolls and running blessings (owner, 2026-10-19).
 */
const RETIRED_FIELDS = ["blessingPoints", "blessings", "coastalWeek", "scrolls"] as const;

/** The code tutorial's field before the home quest book (QU5); converted on load. */
const LEGACY_TUTORIAL_FIELD = "tutorial";

const migratedQuestBook = (stored: Record<string, unknown>) => {
  if (LEGACY_TUTORIAL_FIELD in stored) return migrateLegacyTutorial(stored[LEGACY_TUTORIAL_FIELD]) ?? undefined;
  return validHomeQuestProgress(stored.questBook) ? stored.questBook : undefined;
};

/**
 * Drops retired fields, converts the code tutorial into the home quest book state and resets quest progress the
 * book no longer accepts (owner 2026-10-20: old tutorial progress may simply restart); current progress is
 * returned unchanged.
 */
export const migratePlayerProgress = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const stored = value as Record<string, unknown>;
  const questBook = migratedQuestBook(stored);
  const unchanged = questBook === stored.questBook && !(LEGACY_TUTORIAL_FIELD in stored);
  if (unchanged && RETIRED_FIELDS.every(field => !(field in stored))) return value;
  const progress: Record<string, unknown> = { ...stored, questBook };
  for (const field of [...RETIRED_FIELDS, LEGACY_TUTORIAL_FIELD]) delete progress[field];
  if (questBook === undefined) delete progress.questBook;
  return progress;
};

/** The UTC calendar day of a game time (ms): quests renew at UTC midnight, whatever the time zone. */
export const questDayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

export interface DailyQuestRefreshContext extends DailyQuestCapabilities {
  /** Paid physical relief or ready rewards must survive midnight until their one claim completes. */
  retainedQuestIds?: ReadonlySet<string>;
}

/** Keeps today's quests (dropping retired delivery quests of older saves) or makes a new day's. */
export const refreshQuests = (
  progress: PlayerProgress, day: string, toolWares?: ReadonlySet<string>, nation?: WorkerNation,
  context?: DailyQuestRefreshContext
): PlayerProgress => {
  const level = levelForExperience(progress.experience);
  const paid = retainedReliefQuestIds(progress.relief);
  const retained = progress.quests.some(quest => !quest.done &&
    (paid.has(quest.id) || context?.retainedQuestIds?.has(quest.id)));
  if (progress.questDay !== day && !retained) {
    const quests = generateDailyQuests(day, level, progress.seed, toolWares, nation, context);
    const relief = context?.reliefAvailable ? registerReliefQuests(progress.relief, quests, day) : progress.relief;
    return { ...progress, questDay: day, quests, ...(relief ? { relief } : {}) };
  }
  // Recorded relief keeps its exact requested cargo, including early quests after harbour removal.
  // Legacy quests retain their original nation/tier migration policy.
  const quests = progress.quests.map(quest => isReliefQuest(progress.relief, quest.id) ? quest :
    migrateNationQuests(migrateRetiredQuests([quest], level), nation)[0]!);
  return quests.every((quest, index) => quest === progress.quests[index]) ? progress : { ...progress, quests };
};

/** Adds experience; every level crossed pays coins (to the island) and later gems (here). */
export const awardExperience = (progress: PlayerProgress, experience: number) => {
  const before = levelForExperience(progress.experience);
  const total = progress.experience + Math.max(0, Math.round(experience));
  const after = levelForExperience(total);
  const levelUps: LevelUp[] = [];
  for (let level = before + 1; level <= Math.min(after, MAX_PLAYER_LEVEL); level++)
    levelUps.push({ level, ...levelUpReward(level) });
  const gems = levelUps.reduce((sum, entry) => sum + entry.gems, 0);
  return { levelUps, progress: { ...progress, experience: total, gems: progress.gems + gems } };
};

export const recordProduction = (progress: PlayerProgress, ware: string, count = 1): PlayerProgress => {
  if (!progress.quests.some(quest => quest.kind === "produce" && quest.ware === ware && !quest.done)) return progress;
  return { ...progress, quests: progress.quests.map(quest =>
    quest.kind !== "produce" || quest.ware !== ware || quest.done ? quest
      : { ...quest, progress: Math.min(quest.amount, quest.progress + count) }) };
};

const questReady = (quest: DailyQuest) => !quest.done && (quest.kind === "deliver" || quest.progress >= quest.amount);

/**
 * Marks a ready quest done and awards its experience; `goods` are the quest's reward for the caller to
 * store at home. Both carry the daily quest talent; `monumentBonus` adds the Monument's experience bonus.
 * Delivery payment happens before this.
 */
export const completeQuest = (progress: PlayerProgress, id: string, monumentBonus = false) => {
  const quest = progress.quests.find(entry => entry.id === id);
  if (!quest || !questReady(quest)) return null;
  if (isReliefQuest(progress.relief, id) && !canClaimReliefQuest(progress.relief, id)) return null;
  const done = { ...progress, quests: progress.quests.map(entry => entry === quest ? { ...entry, done: true } : entry),
    ...(progress.relief ? { relief: completeReliefQuest(progress.relief, id) } : {}) };
  const experience = monumentExperience(questRewardExperience(progress.talents, quest.experience), monumentBonus);
  const result = awardExperience(done, experience);
  return { ...result, goods: questRewardGoods(progress.talents, quest.reward) };
};

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const validGoods = (goods: unknown) => Boolean(goods) && typeof goods === "object" && !Array.isArray(goods) &&
  Object.values(goods as object).every(count);

export const validatePlayerProgress = (value: unknown): value is PlayerProgress => {
  const progress = value as PlayerProgress;
  return Boolean(progress) && progress.version === 1 && count(progress.experience) && count(progress.gems) &&
    count(progress.seed) && validPlayerInventory(progress.inventory) && validInboxMails(progress.messages) && validateReliefQuestState(progress.relief) &&
    (progress.commander === undefined || (Boolean(progress.commander) &&
      typeof progress.commander!.id === "string" && progress.commander!.id.length > 0 &&
      progress.commander!.id.length <= 120 && count(progress.commander!.homeIslandSeed))) &&
    (progress.questSeenDay === undefined || typeof progress.questSeenDay === "string") &&
    (progress.homeMonument === undefined || progress.homeMonument === true) &&
    validLocalCampaignVictories(progress.campaignVictories) && validLocalCampaignProgress(progress.campaignProgress) &&
    typeof progress.questDay === "string" && Array.isArray(progress.quests) &&
    (progress.questBook === undefined || validHomeQuestProgress(progress.questBook)) &&
    talentRanksError(progress.talents, levelForExperience(progress.experience)) === null &&
    progress.quests.every(quest => quest && typeof quest.ware === "string" && count(quest.amount) &&
      count(quest.progress) && count(quest.experience) && ["deliver", "produce"].includes(quest.kind) &&
      validGoods(quest.reward));
};
