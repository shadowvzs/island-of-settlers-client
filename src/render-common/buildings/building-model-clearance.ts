import { DMath } from "../../shared/math/deterministic-math";
import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { getBuildingDefinition } from "./building-catalog";
import { createRomanBuildingRecipe, type Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { getRomanBuildingWorldSizing } from "./building-world-sizing";

export interface PlacedBuildingModel {
  typeId: number;
  x: number;
  y: number;
  z: number;
  /** Quarter turns, matching authoritative placement. */
  rotation: number;
}
export interface BuildingCollisionBox { min: Point3; max: Point3 }
const CLEARANCE = .08;
const solidCache = new Map<number, BuildingCollisionBox[]>();
const rotationTerms = (turns: number) => {
  const angle = turns * Math.PI / 2;
  return { cosine: Math.round(DMath.cos(angle)), sine: Math.round(DMath.sin(angle)) };
};
const localModelBoxes = (typeId: number) => {
  const previous = solidCache.get(typeId);
  if (previous) return previous;
  const boxes: BuildingCollisionBox[] = [];
  const seen = new Set<string>();
  for (const detailed of [true, false]) {
    const recipe = createRomanBuildingRecipe(getBuildingDefinition(typeId), detailed);
    for (const part of recipe.parts) {
      const bounds = getRomanPartBounds(part);
      const key = [...bounds.min, ...bounds.max].map(value => value.toFixed(5)).join(":");
      if (seen.has(key)) continue;
      seen.add(key); boxes.push(bounds);
    }
  }
  // Other mill sails remain physical obstacles too, including their complete rotating sweep.
  const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(typeId));
  for (const rotor of sizing.overhead) boxes.push({
    min: [rotor.center[0] - rotor.radius, rotor.center[1] - rotor.radius, rotor.center[2] - rotor.halfDepth],
    max: [rotor.center[0] + rotor.radius, rotor.center[1] + rotor.radius, rotor.center[2] + rotor.halfDepth]
  });
  solidCache.set(typeId, boxes);
  return boxes;
};

/** Quarter-turn transformed boxes of the union of both LODs, in real world coordinates. */
const placeModelBox = (building: PlacedBuildingModel, bounds: BuildingCollisionBox, scale: number): BuildingCollisionBox => {
  const { cosine, sine } = rotationTerms(building.rotation);
  const transform = (point: Point3): Point3 => [
    building.x + (point[0] * cosine + point[2] * sine) * scale,
    building.y + point[1] * scale,
    building.z + (-point[0] * sine + point[2] * cosine) * scale
  ];
  const first = transform(bounds.min), second = transform(bounds.max);
  return {
    min: first.map((value, axis) => Math.min(value, second[axis]!)) as Point3,
    max: first.map((value, axis) => Math.max(value, second[axis]!)) as Point3
  };
};
export const getPlacedBuildingModelBoxes = (building: PlacedBuildingModel): BuildingCollisionBox[] => {
  const { scale } = getRomanBuildingWorldSizing(getBuildingDefinition(building.typeId));
  return localModelBoxes(building.typeId).map(bounds => placeModelBox(building, bounds, scale));
};
export const getPlacedBuildingOverheadBounds = (building: PlacedBuildingModel): BuildingCollisionBox[] => {
  const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(building.typeId));
  return sizing.overhead.map(rotor => placeModelBox(building, {
    min: [rotor.center[0] - rotor.radius, rotor.center[1] - rotor.radius, rotor.center[2] - rotor.halfDepth],
    max: [rotor.center[0] + rotor.radius, rotor.center[1] + rotor.radius, rotor.center[2] + rotor.halfDepth]
  }, sizing.scale));
};
export const getPlacedBuildingEntranceBounds = (building: PlacedBuildingModel): BuildingCollisionBox[] => {
  const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(building.typeId));
  return sizing.entrance.map(bounds => placeModelBox(building, bounds, sizing.scale));
};
const buildingBoxesOverlap = (first: BuildingCollisionBox, second: BuildingCollisionBox) =>
  first.min.every((value, axis) => value < second.max[axis]! && first.max[axis]! > second.min[axis]!);

const modelUnions = new Map<number, BuildingCollisionBox | null>();
/**
 * Local box enclosing every model box of a type; null when it has no finite bounds. A quarter turn, a scale and
 * a shift are monotone per axis, so the placed union encloses every placed model box exactly (broad phase).
 */
const localModelUnion = (typeId: number) => {
  const cached = modelUnions.get(typeId);
  if (cached !== undefined) return cached;
  const min: Point3 = [Infinity, Infinity, Infinity], max: Point3 = [-Infinity, -Infinity, -Infinity];
  for (const box of localModelBoxes(typeId)) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis]!, box.min[axis]!);
    max[axis] = Math.max(max[axis]!, box.max[axis]!);
  }
  const union = [...min, ...max].every(Number.isFinite) ? { max, min } : null;
  modelUnions.set(typeId, union);
  return union;
};

/** Whether a placed entrance box overlaps any model box of `model` (broad phase on the model's union first). */
const entrancesHitModel = (entrances: readonly BuildingCollisionBox[], model: PlacedBuildingModel) => {
  if (!entrances.length) return false;
  const union = localModelUnion(model.typeId);
  if (union) {
    const { scale } = getRomanBuildingWorldSizing(getBuildingDefinition(model.typeId));
    const placed = placeModelBox(model, union, scale);
    if (!entrances.some(entrance => buildingBoxesOverlap(entrance, placed))) return false;
  }
  return getPlacedBuildingModelBoxes(model).some(box =>
    entrances.some(entrance => buildingBoxesOverlap(entrance, box)));
};

/** Whether any of the placed entrance boxes (`getPlacedBuildingEntranceBounds`) overlaps `box`. */
export const entrancesIntersectBox = (entrances: readonly BuildingCollisionBox[], box: BuildingCollisionBox) =>
  entrances.some(entrance => buildingBoxesOverlap(entrance, box));

export const buildingEntranceIntersectsBox = (building: PlacedBuildingModel, box: BuildingCollisionBox) =>
  entrancesIntersectBox(getPlacedBuildingEntranceBounds(building), box);

/**
 * `buildingEntrancesObstructModels` with the first building's placed entrance boxes given, so a placement
 * check computes them once for every neighbour.
 */
export const placedEntrancesObstructModels = (first: PlacedBuildingModel,
  firstEntrances: readonly BuildingCollisionBox[], second: PlacedBuildingModel) =>
  entrancesHitModel(firstEntrances, second) || entrancesHitModel(getPlacedBuildingEntranceBounds(second), first);

/** Neighbor props count too; a compact doorway does not authorize overlap with their geometry. */
export const buildingEntrancesObstructModels = (first: PlacedBuildingModel, second: PlacedBuildingModel) =>
  placedEntrancesObstructModels(first, getPlacedBuildingEntranceBounds(first), second);

/** Exact disk-vs-box test in the rotor's plane, rather than claiming a large ground square. */
export const buildingOverheadIntersectsBox = (building: PlacedBuildingModel, box: BuildingCollisionBox) => {
  const sizing = getRomanBuildingWorldSizing(getBuildingDefinition(building.typeId));
  if (!sizing.overhead.length) return false;
  const { cosine, sine } = rotationTerms(building.rotation);
  const inverse = (point: Point3): Point3 => [
    (point[0] - building.x) * cosine - (point[2] - building.z) * sine,
    point[1] - building.y,
    (point[0] - building.x) * sine + (point[2] - building.z) * cosine
  ];
  const first = inverse(box.min), second = inverse(box.max);
  const min = first.map((value, axis) => Math.min(value, second[axis]!));
  const max = first.map((value, axis) => Math.max(value, second[axis]!));
  for (const rotor of sizing.overhead) {
    const center = rotor.center.map(value => value * sizing.scale);
    const depth = rotor.halfDepth * sizing.scale + CLEARANCE;
    if (min[2]! > center[2]! + depth || max[2]! < center[2]! - depth) continue;
    const dx = Math.max(min[0]! - center[0]!, 0, center[0]! - max[0]!);
    const dy = Math.max(min[1]! - center[1]!, 0, center[1]! - max[1]!);
    if (DMath.hypot(dx, dy) < rotor.radius * sizing.scale + CLEARANCE) return true;
  }
  return false;
};

const modelReaches = new Map<number, number>();
/** Horizontal radius (world units) around its origin that every model box of a type stays in. */
const getModelReach = (typeId: number) => {
  const cached = modelReaches.get(typeId);
  if (cached !== undefined) return cached;
  const { scale } = getRomanBuildingWorldSizing(getBuildingDefinition(typeId));
  let reach = 0;
  for (const { max, min } of localModelBoxes(typeId))
    reach = Math.max(reach, DMath.hypot(Math.max(-min[0], max[0]), Math.max(-min[2], max[2])) * scale);
  modelReaches.set(typeId, reach);
  return reach;
};

/** Broad phase: false when no model box of `other` can come within the rotor's sweep (+ clearance). */
const rotorMayReach = (mill: PlacedBuildingModel, other: PlacedBuildingModel) =>
  getPlacedBuildingOverheadBounds(mill).some(({ max, min }) => {
    const dx = Math.max(min[0] - CLEARANCE - other.x, 0, other.x - max[0] - CLEARANCE);
    const dz = Math.max(min[2] - CLEARANCE - other.z, 0, other.z - max[2] - CLEARANCE);
    return DMath.hypot(dx, dz) <= getModelReach(other.typeId);
  });

const rotorHitsModel = (mill: PlacedBuildingModel, other: PlacedBuildingModel) =>
  mill.typeId === MILL_TYPE_ID && rotorMayReach(mill, other) &&
  getPlacedBuildingModelBoxes(other).some(box => buildingOverheadIntersectsBox(mill, box));

export const buildingModelsObstructRotors = (first: PlacedBuildingModel, second: PlacedBuildingModel) =>
  rotorHitsModel(first, second) || rotorHitsModel(second, first);
