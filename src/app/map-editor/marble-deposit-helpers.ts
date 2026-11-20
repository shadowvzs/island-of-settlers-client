import { wareDisplayName } from "../../shared/settlement/ware-names";
import { colonyResourcePair } from "../../shared/world/colony-resource-tiers";
import { createMapScenario, type MapScenario } from "../../shared/world/map-scenario";
import type { MarbleDeposit } from "../../shared/world/marble-deposit";
import type { WorldData } from "../../shared/world/world-data";
import { MAP_GENERATOR_MESSAGES as G } from "../map-generator/messages";
import { editorMessage, type EditorText, MAP_EDITOR_MESSAGES as M } from "./messages";
import type { FieldOption } from "./section-store";

/** Stone material names reuse the already reviewed map-generator vocabulary. */
const STONE_MESSAGES = {
  basalt: G.stone.basalt, granite: G.stone.granite, limestone: G.stone.limestone, marble: G.stone.marble,
  stone: G.stone.stone
} as const;

export const stoneLabel = (material: string): EditorText =>
  STONE_MESSAGES[material as keyof typeof STONE_MESSAGES] ?? wareDisplayName(material);

/** Writes the sources where `getAuthoredDeposits` (shared/world/marble-deposit) reads them (a new array: the settlement re-resolves). */
export const setAuthoredDeposits = (world: WorldData, deposits: MarbleDeposit[]) => {
  if (world.scenario?.marbleDeposits) {
    world.scenario = { ...world.scenario, marbleDeposits: deposits };
    return;
  }
  world.colonyStoneDeposits = deposits;
};

/** The scenario the placement proof checks: the map's scenario, or a scratch one on a plain map. */
export const toValidationScenario = (world: WorldData, deposits: MarbleDeposit[]): MapScenario =>
  ({ ...(world.scenario ?? createMapScenario()), marbleDeposits: deposits });

/** Why a colony map refuses the material (its saved tier allows one stone only), or null. */
export const getMaterialRefusal = (world: WorldData, material: string): EditorText | null => {
  if (world.scenario?.marbleDeposits || world.colonyResourceTier === undefined) return null;
  const stone = colonyResourcePair(world.colonyResourceTier).stone;
  if (material === stone) return null;
  return editorMessage(M.hints.colonyStone, { stone: stoneLabel(stone) });
};

/** A deposit of the list select: material, number and remaining amount. */
export const toDepositOption = (deposit: MarbleDeposit): FieldOption => ({
  label: editorMessage(M.coordinate.depositOption, {
    material: stoneLabel(deposit.material ?? "marble"),
    number: deposit.id + 1,
    remaining: deposit.remaining
  }),
  value: String(deposit.id)
});
