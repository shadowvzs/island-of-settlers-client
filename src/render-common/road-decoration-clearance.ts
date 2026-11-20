import type { RoadDecorationDefinition } from "../shared/settlement/road-decoration-catalog";
import type { Point3 } from "./buildings/building-recipe";
import { getRomanPartBounds } from "./buildings/building-recipe-fit";
import { bambooGroveClearanceVolumes } from "./plants/bamboo-grove-clearance";
import { climberStemVolumes, foliagePartBounds } from "./plants/climber-foliage-geometry";
import { ornamentalPlantClearanceVolumes } from "./plants/ornamental-plant-clearance";
import { wisteriaTreeClearanceVolumes } from "./plants/wisteria-tree-graph";
import { createRoadDecorationRecipe } from "./road-decoration-models";
import type { RoadArchStone, RoadDecorationPart } from "./road-decoration-recipe";
import { wisteriaStructureClearance } from "./wisteria-structure-clearance";

export interface RoadDecorationBounds { min: Point3; max: Point3 }
export interface RoadDecorationClearance {
  /** Both graphics levels' actual authored boxes, used for other models and overhead foliage/roof clearance. */
  volumes: readonly RoadDecorationBounds[];
  /** Separate supports; never reserve a solid wall across an open portal for navigation. */
  supports: readonly RoadDecorationBounds[];
}

const archBounds = (part: RoadArchStone): RoadDecorationBounds => {
  const angles = [part.from, part.to];
  for (const angle of [0, Math.PI / 2, Math.PI]) if (angle > part.from && angle < part.to) angles.push(angle);
  const points = angles.flatMap(angle => [part.innerRadius, part.innerRadius + part.thickness].map(radius =>
    [part.position[0] + Math.cos(angle) * radius, part.position[1] + Math.sin(angle) * radius]));
  return { min: [Math.min(...points.map(point => point[0]!)) - .009,
    Math.min(...points.map(point => point[1]!)) - .009, part.position[2] - part.depth / 2 - .009],
  max: [Math.max(...points.map(point => point[0]!)) + .009,
    Math.max(...points.map(point => point[1]!)) + .009, part.position[2] + part.depth / 2 + .009] };
};
export const roadDecorationPartBounds = (part: RoadDecorationPart): RoadDecorationBounds => {
  if (!("kind" in part)) return getRomanPartBounds(part);
  if (part.kind === "arch-stone") return archBounds(part);
  if (part.kind === "foliage-card" || part.kind === "rose-head" || part.kind === "climber-stem")
    return foliagePartBounds(part);
  if (part.kind === "roman-column") return {
    min: [part.position[0] - part.size[0] / 2, part.position[1], part.position[2] - part.size[2] / 2],
    max: [part.position[0] + part.size[0] / 2, part.position[1] + part.size[1], part.position[2] + part.size[2] / 2]
  };
  if (part.kind === "folded-leaf" || part.kind === "botanical-leaf" || part.kind === "wisteria-raceme" ||
    part.kind === "rubble-stone")
    return getRomanPartBounds({ shape: "box", stage: 4, position: part.position, size: part.size,
      rotation: part.rotation, surface: part.surface });
  const [x, y, z] = part.position, [width, height, depth] = part.size;
  if (part.kind === "swept-beam") return { min: [x - width / 2, y - height / 2 + Math.min(0, part.sweep ?? 0), z - depth / 2],
    max: [x + width / 2, y + height / 2 + Math.max(0, part.sweep ?? 0), z + depth / 2] };
  return { min: [x - width / 2, y - .028, z - depth / 2],
    max: [x + width / 2, y + height, z + depth / 2] };
};

/** Reserved boxes of one part: a climber stem is split into short runs, everything else is one box. */
export const roadDecorationPartVolumes = (part: RoadDecorationPart): RoadDecorationBounds[] =>
  "kind" in part && part.kind === "climber-stem" ? climberStemVolumes(part) : [roadDecorationPartBounds(part)];

const union = (boxes: readonly RoadDecorationBounds[]): RoadDecorationBounds => ({
  min: [0, 1, 2].map(axis => Math.min(...boxes.map(box => box.min[axis]!))) as Point3,
  max: [0, 1, 2].map(axis => Math.max(...boxes.map(box => box.max[axis]!))) as Point3
});
const cached = new Map<string, RoadDecorationClearance>();

/** One conservative physical contract is shared by both graphics levels and generated icons. */
export const roadDecorationClearance = (definition: RoadDecorationDefinition): RoadDecorationClearance => {
  const asset = definition.plant;
  const physicalKey = asset ? `plant:${asset.species}:${asset.form}:${asset.variant}:${asset.potted}` : definition.id;
  const existing = cached.get(physicalKey);
  if (existing) return existing;
  const actualPlantVolumes = definition.plant && ornamentalPlantClearanceVolumes(definition.plant);
  let actualStructureVolumes = definition.wisteriaFrame &&
    wisteriaStructureClearance(definition.wisteriaFrame, roadDecorationPartBounds);
  if (definition.wisteriaTreeVariant !== undefined)
    actualStructureVolumes = wisteriaTreeClearanceVolumes(definition.wisteriaTreeVariant);
  if (definition.bambooVariant !== undefined)
    actualStructureVolumes = bambooGroveClearanceVolumes(definition.bambooVariant);
  const volumes = actualPlantVolumes ?? actualStructureVolumes ?? [true, false].flatMap(detailed =>
    createRoadDecorationRecipe(definition, detailed).parts.flatMap(roadDecorationPartVolumes));
  let supports: RoadDecorationBounds[];
  if (definition.plant || definition.wisteriaTreeVariant !== undefined || definition.bambooVariant !== undefined) {
    // Ground roots/pot soles bear on terrain; a broad raised crown never becomes a ground support.
    const ground = volumes.filter(box => box.min[1] <= .06);
    if (!ground.length) throw new Error(`Ornamental plant has no bearing support: ${definition.id}`);
    supports = [union(ground)];
  } else if (!definition.opening) supports = [union(volumes)];
  else {
    const low = volumes.filter(box => box.min[1] < definition.opening!.height);
    supports = [-1, 1].map(side => union(low.filter(box => (box.min[0] + box.max[0]) * side > 0)));
  }
  const result = { volumes, supports };
  cached.set(physicalKey, result);
  return result;
};

export const placeRoadDecorationBounds = (bounds: RoadDecorationBounds, position: Point3,
  yaw: number): RoadDecorationBounds => {
  const cosine = Math.cos(yaw), sine = Math.sin(yaw), points: Point3[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) for (const z of [bounds.min[2], bounds.max[2]])
    points.push([position[0] + x * cosine + z * sine, position[1], position[2] - x * sine + z * cosine]);
  return { min: [Math.min(...points.map(point => point[0])), position[1] + bounds.min[1],
    Math.min(...points.map(point => point[2]))], max: [Math.max(...points.map(point => point[0])),
    position[1] + bounds.max[1], Math.max(...points.map(point => point[2]))] };
};
