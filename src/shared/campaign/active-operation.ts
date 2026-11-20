import { isAdventureIsland } from "../settlement/adventure-rules";
import type { Archipelago, ColonyRecord } from "../settlement/archipelago";
import type { GameSaveV1 } from "../settlement/game-save";
import { campaignRunKey } from "./campaign-run";

/**
 * The one shared operation slot (owner answer Q2, 2026-11-09): an expedition under way, an unfinished adventure,
 * a contested colony or a campaign run. Conquered (and lost) colonies never block. The slot is checked at launch
 * only: an operation that becomes active later (a counterattack on a conquered colony) cancels nothing.
 */
export type ActiveOperationKind = "adventure" | "campaign" | "contestedColony" | "expedition";
export interface ActiveOperation {
  /** The expedition id, or the campaign run key. */
  id: number | string;
  kind: ActiveOperationKind;
}

/** The fields of a home expedition the slot reads (the simulation's expedition or its snapshot). */
export interface OperationExpedition {
  id: number;
  island: unknown;
  status: string;
}
export type OperationArchipelago = Pick<Archipelago, "active" | "adventures" | "campaign" | "colonies" | "released">;

/** English domain refusals; `DOMAIN_REFUSAL_MESSAGES` translates them where they are shown. */
export const OPERATION_BLOCK_REASONS: Readonly<Record<ActiveOperationKind, string>> = {
  adventure: "Finish the current adventure first",
  campaign: "A campaign map is under way; finish or give it up first",
  contestedColony: "A colony is still contested; conquer or disband it first",
  expedition: "Another expedition is still under way"
};

const hasLivingEnemySoldier = (save: GameSaveV1) => (save.settlement.military?.soldiers ?? []).some(soldier =>
  (soldier.combat?.faction ?? 0) > 0 && (soldier.combat?.hp ?? 0) > 0);

/** Filed saves are immutable snapshots: one answer per save object (a refiling is a new object). */
const filedContestedCache = new WeakMap<GameSaveV1, boolean>();

/**
 * Review R29: the record status is only mirrored on a visit, so a filed colony whose last enemy soldier died
 * can still read "contested". The filed save decides: contested while it says so and an enemy soldier lives.
 */
export const filedColonyContested = (save: GameSaveV1) => {
  const cached = filedContestedCache.get(save);
  if (cached !== undefined) return cached;
  const contested = save.settlement.colony?.status === "contested" && hasLivingEnemySoldier(save);
  filedContestedCache.set(save, contested);
  return contested;
};

/** A never visited colony ("landed") has not fought yet; the colony on screen has a live, synced record. */
export const colonyContested = (colony: ColonyRecord, active: number | null) => {
  const filed = colony.expeditionId === active ? undefined : colony.save;
  if (filed?.settlement.colony) return filedColonyContested(filed);
  return colony.status === "contested" || colony.status === "landed";
};

const unrecordedColonyLanding = (pending: readonly OperationExpedition[], archipelago: OperationArchipelago) => {
  const recorded = new Set(archipelago.colonies.map(colony => colony.expeditionId));
  return pending.find(expedition => !isAdventureIsland(expedition.island) && !recorded.has(expedition.id));
};

const archipelagoOperation = (
  pending: readonly OperationExpedition[], archipelago: OperationArchipelago
): ActiveOperation | null => {
  const adventure = archipelago.adventures?.[0];
  if (adventure) return { id: adventure.expeditionId, kind: "adventure" };
  const colony = archipelago.colonies.find(entry => colonyContested(entry, archipelago.active));
  if (colony) return { id: colony.expeditionId, kind: "contestedColony" };
  // An arrived colony expedition the archipelago has not filed yet is a landing that has not fought.
  const landing = unrecordedColonyLanding(pending, archipelago);
  return landing ? { id: landing.id, kind: "contestedColony" } : null;
};

/**
 * What holds the slot, in this order: campaign run, expedition under way, unfinished adventure, contested
 * colony. Without the archipelago (the simulation's own gate) only the home expeditions are known.
 */
export const activeOperation = (
  expeditions: readonly OperationExpedition[], archipelago?: OperationArchipelago
): ActiveOperation | null => {
  if (archipelago?.campaign) return { id: campaignRunKey(archipelago.campaign), kind: "campaign" };
  const released = new Set(archipelago?.released ?? []);
  const pending = expeditions.filter(expedition => !released.has(expedition.id));
  const underWay = pending.find(expedition => expedition.status !== "arrived");
  if (underWay) return { id: underWay.id, kind: "expedition" };
  const adventure = pending.find(expedition => isAdventureIsland(expedition.island));
  if (adventure) return { id: adventure.id, kind: "adventure" };
  return archipelago ? archipelagoOperation(pending, archipelago) : null;
};

/** Why a launch is refused while another operation holds the slot; null when the slot is free. */
export const operationBlockReason = (operation: ActiveOperation | null) =>
  operation ? OPERATION_BLOCK_REASONS[operation.kind] : null;
