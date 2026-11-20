import { colonyResourcePair, type ColonyResourceTier, type ColonyStone } from "../world/colony-resource-tiers";
import { PROP } from "../world/world-data";
import { FORESTER_TYPE_ID, QUARRY_TYPE_ID, WOODCUTTER_TYPE_ID } from "./building-type-ids";
import type { ResourceTarget, SettlementBuilding, SettlementContext } from "./settlement-types";

const BASE_PRODUCERS: ReadonlySet<number> = new Set([
  FORESTER_TYPE_ID, QUARRY_TYPE_ID, WOODCUTTER_TYPE_ID
]);

/**
 * The base Forester, Quarry and Woodcutter: refused to the player on colonies (`allowsMaterialBuilding`), always
 * open to a computer faction's economy (its colony town needs them, EAI3a).
 */
export const isBaseProducer = (id: number) => BASE_PRODUCERS.has(id);

/** Retained colony producers; all timber tiers use the shared Sawmill (33). */
export const MATERIAL_BUILDING_GROUPS = [
  { tier: 1, forester: 41, woodcutter: 42, quarry: 43,
    tree: "hardwoodTree", logs: "hardwoodLogs", planks: "hardwoodPlanks", stone: "marble" },
  { tier: 2, forester: 45, woodcutter: 46, quarry: 47,
    tree: "cedarTree", logs: "cedarLogs", planks: "cedarPlanks", stone: "limestone" },
  { tier: 3, forester: 49, woodcutter: 50, quarry: 51,
    tree: "walnutTree", logs: "walnutLogs", planks: "walnutPlanks", stone: "basalt" },
  { tier: 4, forester: 53, woodcutter: 54, quarry: 55,
    tree: "mahoganyTree", logs: "mahoganyLogs", planks: "mahoganyPlanks", stone: "granite" }
] as const;
export const materialBuildingGroup = (id: number) => MATERIAL_BUILDING_GROUPS.find(group =>
  group.forester === id || group.woodcutter === id || group.quarry === id);
export const isMaterialForester = (id: number) => MATERIAL_BUILDING_GROUPS.some(group => group.forester === id);
export const isMaterialWoodcutter = (id: number) => MATERIAL_BUILDING_GROUPS.some(group => group.woodcutter === id);
export const isMaterialQuarry = (id: number) => MATERIAL_BUILDING_GROUPS.some(group => group.quarry === id);
export const materialPlantingSpecies = (id: number) => {
  const group = materialBuildingGroup(id);
  return group?.forester === id ? group.tree : undefined;
};
/**
 * The same policy serves the menu, placement and debug construction tools. A specialist quarry follows
 * its stone on home maps, including authored deposits. On colonies, all three resource producers
 * must match the island's committed resource pair. `hasDeposit`: the island has that stone.
 */
export const allowsMaterialBuilding = (
  context: SettlementContext, id: number, colony: boolean, hasDeposit: (stone: ColonyStone) => boolean
) => {
  const group = materialBuildingGroup(id);
  if (!group) return !colony || !BASE_PRODUCERS.has(id);
  const pair = colonyResourcePair(context.options.world.colonyResourceTier ?? 1);
  if (colony && group.stone !== pair.stone) return false;
  if (group.quarry === id) return hasDeposit(group.stone);
  return colony && group.tier === (context.options.world.colonyResourceTier ?? 1);
};
/** Why `allowsMaterialBuilding` refused the type. */
export const materialBuildingRefusal = (id: number, tier?: ColonyResourceTier) => {
  const group = materialBuildingGroup(id);
  if (tier !== undefined) {
    const pair = colonyResourcePair(tier);
    if (!group || group.tier !== tier)
      return `This colony requires producers for its ${pair.wood} and ${pair.stone} resource pair`;
  }
  if (group?.quarry === id) return `This quarry needs a ${group.stone} deposit on the island`;
  return "This specialist requires a colony with its matching resource pair";
};
export const materialTargetAllowed = (
  context: SettlementContext, building: SettlementBuilding, target: ResourceTarget
) => {
  if (target.kind !== "tree") return true;
  const type = context.options.world.props.types[target.id]!;
  const group = materialBuildingGroup(building.typeId);
  // Only a matching specialist cutter fells its species; other specialists never select trees by type.
  if (group) return group.woodcutter !== building.typeId || type === PROP[group.tree];
  if (building.typeId !== 17) return true;
  return !MATERIAL_BUILDING_GROUPS.some(candidate => type === PROP[candidate.tree]);
};

/** Freeze a stone mine's actual island material at cycle start, including restored legacy cycles. */
export const materialMineOutput = (context: SettlementContext, building: SettlementBuilding, ware: string): string =>
  building.typeId === 10 && ware === "stone" && context.options.world.colonyResourceTier
    ? colonyResourcePair(context.options.world.colonyResourceTier).stone : ware;
