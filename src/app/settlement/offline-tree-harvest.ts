import { DMath } from "../../shared/math/deterministic-math";
import { isMaterialWoodcutter, MATERIAL_BUILDING_GROUPS } from "../../shared/settlement/advanced-material-production";
import { TREE_TYPES } from "../../shared/settlement/settlement-resources";
import type { SettlementActor, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { resourceWorkRadius } from "../../shared/settlement/settlement-work-ranges";
import { PROP, type WorldData } from "../../shared/world/world-data";

/** The plain woodcutter and forester; material ones fell and plant their own species. */
export const WOODCUTTER = 17;
const FORESTER = 20;
/** Smallest tree scale a woodcutter fells (settlement-resources work targets). */
const FELLABLE_SCALE = .7;

/** The tree props each woodcutter type fells. */
const treesFelledBy = (woodcutterType: number): ReadonlySet<number> => {
  const group = MATERIAL_BUILDING_GROUPS.find(entry => entry.woodcutter === woodcutterType);
  return group ? new Set([PROP[group.tree]]) : TREE_TYPES;
};

/** The flow key of the trees a woodcutter type fells (`~tree` for the plain one). */
export const treeKey = (woodcutterType: number) =>
  woodcutterType === WOODCUTTER ? "~tree" : `~tree:${woodcutterType}`;

/** The woodcutter type whose trees a forester type plants, if it is one. */
export const plantedFor = (foresterType: number) => foresterType === FORESTER ? WOODCUTTER
  : MATERIAL_BUILDING_GROUPS.find(group => group.forester === foresterType)?.woodcutter;

export const isWoodcutterType = (typeId: number) =>
  typeId === WOODCUTTER || MATERIAL_BUILDING_GROUPS.some(group => group.woodcutter === typeId);

const isWorkingWoodcutter = (building: SettlementBuilding, woodcutterType: number) =>
  building.typeId === woodcutterType && building.construction === 1 && building.worker !== undefined;

/**
 * Mature trees the island's woodcutters of a type would fell next, nearest to a woodcutter first,
 * never one an actor is already working on: a jump fells these when the measured forest shrinks.
 */
export const fellableTrees = (
  world: WorldData, buildings: readonly SettlementBuilding[], actors: readonly SettlementActor[],
  canHarvest: (id: number) => boolean, woodcutterType = WOODCUTTER
) => {
  const woodcutters = buildings.filter(building => isWorkingWoodcutter(building, woodcutterType));
  const range = resourceWorkRadius("tree"), types = treesFelledBy(woodcutterType);
  const targeted = new Set(actors.flatMap(actor => actor.target?.kind === "tree" ? [actor.target.id] : []));
  const trees: { distance: number; id: number }[] = [];
  for (let id = 0; id < world.props.count && woodcutters.length; id++) {
    if (!types.has(world.props.types[id]!) || world.props.scale[id]! < FELLABLE_SCALE) continue;
    if (targeted.has(id) || !canHarvest(id)) continue;
    const distance = Math.min(...woodcutters.map(building =>
      DMath.hypot(world.props.x[id]! - building.x, world.props.z[id]! - building.z)));
    if (distance <= range) trees.push({ distance, id });
  }
  return trees.sort((a, b) => a.distance - b.distance || a.id - b.id).map(tree => tree.id);
};

/** Whether a shrinking forest is felled only by woodcutters a skip can stand in for. */
export const hasOnlyPlainWoodcutters = (buildings: readonly SettlementBuilding[]) =>
  !buildings.some(building => building.construction === 1 && isMaterialWoodcutter(building.typeId));
