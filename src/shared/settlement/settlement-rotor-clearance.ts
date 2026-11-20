import { type BuildingCollisionBox,   buildingEntranceIntersectsBox, buildingModelsObstructRotors, buildingOverheadIntersectsBox,
getPlacedBuildingOverheadBounds, type PlacedBuildingModel }
  from "../../render-common/buildings/building-model-clearance";
import { getMatureVariant, getTreeInstanceScale, getTreeSpecies, getTreeVariant,
  getTreeVariants, TREE_KINDS } from "../../render-common/props/island-trees";
import { NATIVE_TREE_CLEARANCE_BOUNDS } from "../../render-common/trees/tree-clearance-bounds";
import { DMath } from "../math/deterministic-math";
import { sampleSmooth } from "../world/grid-geometry";
import { somePropNear } from "../world/prop-cell-index";
import { PROP_REMOVED, type WorldData } from "../world/world-data";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

interface TreeClearance { height: number; radius: number; windRadius: number; windHeight: number }
const treeBounds = new Map<string, TreeClearance>();
// computeEnvironment's strongest configured precipitation winds, including simultaneous endpoints.
const MAX_WEATHER_WIND = DMath.hypot(.8, .35) * 2.7;
const nativeTreeBounds = (kind: number, variant: number): TreeClearance => {
  const key = `${kind}:${variant}`, previous = treeBounds.get(key);
  if (previous) return previous;
  const native = NATIVE_TREE_CLEARANCE_BOUNDS[kind]?.[variant];
  if (!native) throw new Error(`Missing native tree clearance: ${kind}:${variant}`);
  const [height = 0, radius = 0, sway = 0, flutter = 0] = native;
  const result = { height, radius,
    windRadius: MAX_WEATHER_WIND * (sway * sway * .14 + flutter * .015 * Math.SQRT2),
    windHeight: MAX_WEATHER_WIND * (sway * sway * .03 + flutter * .009) };
  treeBounds.set(key, result);
  return result;
};

const treeVolume = (x: number, y: number, z: number, bounds: { height: number; radius: number }): BuildingCollisionBox => ({
  min: [x - bounds.radius, y, z - bounds.radius],
  max: [x + bounds.radius, y + bounds.height, z + bounds.radius]
});
const placedTreeBounds = (world: WorldData, index: number) => {
  const kind = world.props.types[index]!, scale = world.props.scale[index] ?? 1;
  const variant = getTreeVariant(kind, scale, world.props.form?.[index] ?? 0);
  let height = 0, radius = 0;
  for (const version of new Set([variant, getMatureVariant(kind, variant)])) {
    const instance = getTreeInstanceScale(kind, scale, version), native = nativeTreeBounds(kind, version);
    height = Math.max(height, (native.height + native.windHeight) * instance);
    radius = Math.max(radius, (native.radius + native.windRadius) * instance);
  }
  return { height, radius };
};
export const getPlacedTreeClearanceBox = (world: WorldData, index: number) => {
  const x = world.props.x[index]!, z = world.props.z[index]!;
  const y = world.props.y?.[index] ?? sampleSmooth(world, world.heights, x, z);
  return treeVolume(x, y, z, placedTreeBounds(world, index));
};

/** Broad phase (cells): trees farther from the plot centre are never checked in detail. */
const TREE_BROAD_PHASE = 10;

/**
 * Whether a standing tree outside the building's plot, within the broad phase of its centre,
 * satisfies `collides`. Uses the prop cell index, so only nearby trees are visited.
 */
export const someTreeNearPlot = (
  world: WorldData, building: SettlementBuilding, collides: (index: number, x: number, z: number) => boolean
) => somePropNear(world, building.x, building.z, TREE_BROAD_PHASE, (index) => {
  const type = world.props.types[index]!;
  if (type === PROP_REMOVED || getTreeSpecies(type) === undefined) return false;
  const x = world.props.x[index]!, z = world.props.z[index]!;
  if (x >= building.x - building.width / 2 && x < building.x + building.width / 2 &&
    z >= building.z - building.depth / 2 && z < building.z + building.depth / 2) return false;
  if (DMath.hypot(x - building.x, z - building.z) > TREE_BROAD_PHASE) return false;
  return collides(index, x, z);
});

/** Existing roofs and mature tree crowns collide with the real oriented sail sweep, including wind. */
export const rotorPlacementReason = (context: SettlementContext, building: SettlementBuilding) => {
  for (const existing of context.buildings)
    if (buildingModelsObstructRotors(building, existing)) return "Mill sails would overlap another building";
  if (building.typeId !== 31) return null;
  const { world } = context.options;
  if (getPlacedBuildingOverheadBounds(building).some(bounds => bounds.min[0] < 0 || bounds.min[2] < 0 ||
    bounds.max[0] >= world.cellsX || bounds.max[2] >= world.cellsZ)) return "Mill sails leave the island grid";
  const blocked = someTreeNearPlot(world, building, (index, x, z) => {
    const y = world.props.y?.[index] ?? sampleSmooth(world, world.heights, x, z);
    return buildingOverheadIntersectsBox(building, treeVolume(x, y, z, placedTreeBounds(world, index)));
  });
  return blocked ? "Mill sails would overlap a tree outside its plot" : null;
};
let matureBounds: { height: number; radius: number } | undefined;
const getMatureTreeBounds = () => {
  if (matureBounds) return matureBounds;
  let height = 0, radius = 0;
  for (const kind of TREE_KINDS) for (const [variant, version] of getTreeVariants(kind).entries()) {
    if (version.stage !== 5) continue;
    const bounds = nativeTreeBounds(kind, variant);
    height = Math.max(height, (bounds.height + bounds.windHeight) * 1.12);
    radius = Math.max(radius, (bounds.radius + bounds.windRadius) * 1.12);
  }
  matureBounds = { height, radius };
  return matureBounds;
};

/** Forester candidate sites must remain safe when any locally chosen species reaches maturity. */
export const treePlantingClearsRotors = (buildings: readonly PlacedBuildingModel[], x: number, y: number, z: number) => {
  const protectedBuildings = buildings.filter(building => [1, 20, 31].includes(building.typeId));
  if (!protectedBuildings.length || protectedBuildings.every(building => DMath.hypot(x - building.x, z - building.z) > 10)) return true;
  const volume = treeVolume(x, y, z, getMatureTreeBounds());
  return protectedBuildings.every(building => !buildingOverheadIntersectsBox(building, volume) &&
    !buildingEntranceIntersectsBox(building, volume));
};
