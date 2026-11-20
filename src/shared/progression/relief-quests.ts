import { RELIEF_FORBIDDEN_WARES } from "@shared/catalog/balance";

import { WARE_IDS } from "../../render-common/wares/ware-catalog";
import type { DailyQuest } from "./daily-quests";

export const isReliefDonationWare = (ware: string) =>
  (WARE_IDS as readonly string[]).includes(ware) && !RELIEF_FORBIDDEN_WARES.has(ware);

export type ReliefQuestStage = "awaiting-aid" | "paid-awaiting-ship" | "loading" | "departing" |
  "ready-to-claim" | "completed" | "returned";
export interface ReliefQuestReturn {
  questId: string; ware: string; amount: number; islandSeed: number; harbourUid: number;
}

/** Player-wide identity/receipt; physical reservations and ships remain in their owning island save. */
export interface ReliefQuestStatus {
  questId: string;
  day: string;
  ware: string;
  amount: number;
  stage: ReliefQuestStage;
  loaded: number;
  departed: boolean;
  islandSeed?: number;
  harbourUid?: number;
  blocker?: string;
  /** Read-only availability projection; never needed by the persisted mission receipt. */
  payable?: boolean;
  available?: number;
}
export interface ReliefQuestState { version: 1; missions: ReliefQuestStatus[] }

export const reliefQuestRecord = (state: ReliefQuestState | undefined, id: string) =>
  state?.missions.find(mission => mission.questId === id);
export const isReliefQuest = (state: ReliefQuestState | undefined, id: string) =>
  reliefQuestRecord(state, id) !== undefined;
export const canClaimReliefQuest = (state: ReliefQuestState | undefined, id: string) => {
  const mission = reliefQuestRecord(state, id);
  return mission?.stage === "ready-to-claim" && mission.loaded === mission.amount && mission.departed;
};
export const completeReliefQuest = (state: ReliefQuestState | undefined, id: string): ReliefQuestState | undefined =>
  !state || !canClaimReliefQuest(state, id) ? state : { ...state, missions: state.missions.map(mission =>
    mission.questId === id ? { ...mission, stage: "completed" } : mission) };

/** Only an explicit physical expiry/refund receipt terminates paid aid; missing islands never imply a return. */
export const returnReliefQuests = (state: ReliefQuestState | undefined,
  records: readonly ReliefQuestReturn[]): ReliefQuestState | undefined => {
  if (!state) return state;
  let changed = false;
  const missions = state.missions.map(mission => {
    if (mission.stage === "awaiting-aid" || mission.stage === "completed" || mission.stage === "returned" || mission.departed)
      return mission;
    const receipt = records.find(record => record.questId === mission.questId && record.ware === mission.ware &&
      record.amount === mission.amount && (mission.islandSeed === undefined || record.islandSeed === mission.islandSeed) &&
      (mission.harbourUid === undefined || record.harbourUid === mission.harbourUid));
    if (!receipt) return mission;
    changed = true;
    return { ...mission, stage: "returned" as const, islandSeed: receipt.islandSeed,
      harbourUid: receipt.harbourUid, blocker: undefined };
  });
  return changed ? { ...state, missions } : state;
};

/** Only a newly rolled day calls this; existing ordinary saved deliveries never become relief missions. */
export const registerReliefQuests = (state: ReliefQuestState | undefined, quests: readonly DailyQuest[], day: string) => {
  const fresh = quests.filter(quest => quest.kind === "deliver" && !isReliefQuest(state, quest.id));
  if (!fresh.length) return state;
  return { version: 1 as const, missions: [...(state?.missions ?? []), ...fresh.map(quest => ({
    questId: quest.id, day, ware: quest.ware, amount: quest.amount, stage: "awaiting-aid" as const,
    loaded: 0, departed: false
  }))] };
};

export const retainedReliefQuestIds = (state: ReliefQuestState | undefined): ReadonlySet<string> =>
  new Set(state?.missions.filter(mission => mission.stage !== "awaiting-aid" && mission.stage !== "completed" &&
    mission.stage !== "returned")
    .map(mission => mission.questId));

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const text = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 200;
const STAGES: readonly ReliefQuestStage[] = ["awaiting-aid", "paid-awaiting-ship", "loading", "departing", "ready-to-claim", "completed", "returned"];
export const validateReliefQuestState = (value: unknown): value is ReliefQuestState | undefined => {
  if (value === undefined) return true;
  const state = value as ReliefQuestState;
  if (!state || state.version !== 1 || !Array.isArray(state.missions)) return false;
  const ids = new Set<string>();
  return state.missions.every(mission => {
    if (!mission || !text(mission.questId) || ids.has(mission.questId) || !text(mission.day) ||
      !text(mission.ware) || !count(mission.amount) || mission.amount < 1 || !count(mission.loaded) ||
      mission.loaded > mission.amount || !STAGES.includes(mission.stage) || typeof mission.departed !== "boolean" ||
      (mission.islandSeed !== undefined && !count(mission.islandSeed)) ||
      (mission.harbourUid !== undefined && !count(mission.harbourUid)) ||
      (mission.blocker !== undefined && typeof mission.blocker !== "string")) return false;
    ids.add(mission.questId);
    const ready = mission.stage === "ready-to-claim" || mission.stage === "completed";
    if (ready && (mission.loaded !== mission.amount || !mission.departed)) return false;
    if (mission.stage === "awaiting-aid" && (mission.loaded !== 0 || mission.departed)) return false;
    if (mission.stage === "returned" && mission.departed) return false;
    return true;
  });
};
