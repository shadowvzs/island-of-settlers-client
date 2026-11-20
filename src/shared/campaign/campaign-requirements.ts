import type {
  CampaignCargo, CampaignUnlockCondition
} from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { TROOP_DECK_SLOTS } from "../balance/colonies";
import { colonyDeckItems, type ColonyTroops, packColonyLoads } from "../settlement/colony-expedition-rules";
import { expeditionReadinessReason } from "../settlement/expedition-launch-rules";
import type { Goods } from "../settlement/settlement-types";
import { wareDisplayName } from "../settlement/ware-names";
import { type ActiveOperation, operationBlockReason } from "./active-operation";

/**
 * One shared answer for the campaign map button, its tooltip and the launch (plan item 3): the same eligible
 * soldiers (`expeditionReserveSoldiers`: free own reserves with a road route to the harbour), the same pooled
 * harbour stock the fleet debits, the same idle ships and the same deck packing as a colony expedition.
 */
export type CampaignRequirementKind = "goods" | "settlers" | "soldiers";
export interface CampaignRequirementLine {
  available: number;
  /** Ware id, soldier type or "settlers". */
  item: string;
  kind: CampaignRequirementKind;
  missing: number;
  required: number;
}
/** What the chosen home harbour can send now. */
export interface CampaignHomeSupply {
  /** Pooled stock at the harbour (its inventory view is the storage pool, R9). */
  goods: (ware: string) => number;
  idleShips: number;
  /** Idle settlers that can walk to the harbour. */
  settlers: number;
  soldiers: Readonly<Partial<ColonyTroops>>;
}
export interface CampaignLaunchRequirements {
  cargo: CampaignCargo;
  /** Highest `playerLevel` unlock condition; absent when the map has none. */
  requiredLevel?: number;
}
export interface CampaignLaunchGates {
  operation: ActiveOperation | null;
  playerLevel: number;
}
export interface CampaignRequirementStatus {
  idleShips: number;
  levelBlock: string | null;
  lines: CampaignRequirementLine[];
  operationBlock: string | null;
  /** The first refusal the launch reports; null when the map can start. */
  reason: string | null;
  /** Decks the whole cargo needs; more decks than idle ships means several trips (plan item 4). */
  shipsNeeded: number;
}

const NO_HARBOUR = "Choose a completed harbour";
const NO_SUPPLY: CampaignHomeSupply = Object.freeze({ goods: () => 0, idleShips: 0, settlers: 0, soldiers: {} });

/** The strictest player-level unlock condition of a map. */
export const campaignRequiredLevel = (unlock: readonly CampaignUnlockCondition[]) => {
  let level: number | undefined;
  for (const condition of unlock) if (condition.kind === "playerLevel") level = Math.max(level ?? 0, condition.level);
  return level;
};

const requirementLine = (
  kind: CampaignRequirementKind, item: string, required: number, available: number
): CampaignRequirementLine => ({ available, item, kind, missing: Math.max(0, required - available), required });

/** Soldier types, then wares, then settlers: the order the tooltip lists them. */
const requirementLines = (cargo: CampaignCargo, supply: CampaignHomeSupply) => [
  ...cargo.soldiers.map(({ amount, type }) => requirementLine("soldiers", type, amount, supply.soldiers[type] ?? 0)),
  ...cargo.goods.map(({ amount, ware }) => requirementLine("goods", ware, amount, supply.goods(ware))),
  ...(cargo.settlers > 0 ? [requirementLine("settlers", "settlers", cargo.settlers, supply.settlers)] : [])
];

/** Soldiers (by deck slots) and settlers board first, then the boxes: the colony packing order. */
const campaignShipsNeeded = (cargo: CampaignCargo) => {
  const passengers = cargo.soldiers.flatMap(({ amount, type }) =>
    Array.from({ length: amount }, () => ({ slots: TROOP_DECK_SLOTS[type], uid: -1 })));
  for (let settler = 0; settler < cargo.settlers; settler++) passengers.push({ slots: 1, uid: -1 });
  const goods: Goods = {};
  for (const { amount, ware } of cargo.goods) goods[ware] = (goods[ware] ?? 0) + amount;
  return packColonyLoads(colonyDeckItems(passengers, goods)).length;
};

/** The colony readiness text over the eligible soldiers this cargo can actually use (capped per type). */
const soldierShipReason = (lines: readonly CampaignRequirementLine[], idleShips: number) => {
  const soldiers = lines.filter(line => line.kind === "soldiers");
  const required = soldiers.reduce((sum, line) => sum + line.required, 0);
  const usable = soldiers.reduce((sum, line) => sum + Math.min(line.available, line.required), 0);
  return expeditionReadinessReason(required, { shield: usable }, idleShips);
};

const cargoReason = (lines: readonly CampaignRequirementLine[]) => {
  const goods = lines.find(line => line.kind === "goods" && line.missing > 0);
  if (goods)
    return `Not enough free ${wareDisplayName(goods.item)}: needs ${goods.required}, ${goods.available} free`;
  const settlers = lines.find(line => line.kind === "settlers" && line.missing > 0);
  return settlers ? `Requires ${settlers.required} idle settlers (${settlers.available} available)` : null;
};

const levelBlockReason = (requiredLevel: number | undefined, playerLevel: number) =>
  requiredLevel !== undefined && playerLevel < requiredLevel ? `Unlocks at player level ${requiredLevel}` : null;

/**
 * The launch gate of a campaign map without a home island (plan §7.4 step 3, rev H5): only the player level (the
 * effective level of the rules); no harbour, cargo, ships or operation slot exist, and `homeGoods`/`homeBuilding`
 * unlock conditions never apply.
 */
export const homelessLaunchBlock = (requiredLevel: number | undefined, playerLevel: number) =>
  levelBlockReason(requiredLevel, playerLevel);

/**
 * Per cargo line `{ item, required, available, missing }`, ships needed and idle, the operation slot and the level
 * gate. `supply` is undefined without a completed harbour. Refusal order: operation, level, harbour, soldiers and
 * ships (the colony readiness text), wares, settlers.
 */
export const campaignRequirementStatus = (
  { cargo, requiredLevel }: CampaignLaunchRequirements, supply: CampaignHomeSupply | undefined,
  { operation, playerLevel }: CampaignLaunchGates
): CampaignRequirementStatus => {
  const lines = requirementLines(cargo, supply ?? NO_SUPPLY);
  const operationBlock = operationBlockReason(operation);
  const levelBlock = levelBlockReason(requiredLevel, playerLevel);
  const idleShips = supply?.idleShips ?? 0;
  const harbourBlock = supply ? null : NO_HARBOUR;
  const reason = operationBlock ?? levelBlock ?? harbourBlock ?? soldierShipReason(lines, idleShips) ??
    cargoReason(lines);
  return { idleShips, levelBlock, lines, operationBlock, reason, shipsNeeded: campaignShipsNeeded(cargo) };
};
