import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import { ornamentalPlantModel } from "../../../../island-of-settlers-shared/src/road-plant-models";
import { ROAD_DECORATION_OPENING } from "../../shared/settlement/road-decoration-catalog";
import type { Point3 } from "../buildings/building-recipe";
import { createBonsaiElmGraph } from "./bonsai-elm-graph";
import { catalogPlantClearance } from "./catalog-plant-clearance";
import { floweringPeachClearanceVolumes } from "./flowering-peach-physical";
import { createMapleTreeGraph } from "./maple-tree-graph";
import type { OrnamentalTreeGraph } from "./ornamental-tree-graph";
import { createRoadsideShrubGraph, ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE } from "./roadside-shrub-graph";
import { romanGardenTreeClearanceVolumes } from "./roman-garden-tree-physical";

const pointBox = (point: Point3, radius: number) => ({
  min: point.map(value => value - radius) as Point3,
  max: point.map(value => value + radius) as Point3
});
type Bounds = ReturnType<typeof pointBox>;

const addCrownVolume = (crowns: Map<string, Bounds>, box: Bounds, centre: Point3, size: number) => {
  const key = `${size}:${centre.map(value => Math.floor(value / size)).join(":")}`;
  const existing = crowns.get(key);
  if (!existing) { crowns.set(key, box); return; }
  for (const axis of [0, 1, 2]) {
    existing.min[axis] = Math.min(existing.min[axis]!, box.min[axis]!);
    existing.max[axis] = Math.max(existing.max[axis]!, box.max[axis]!);
  }
};

/** Pure authored-graph bounds: independent of graphics tier, textures, camera and GPU builders. */
const graphVolumes = (graph: OrnamentalTreeGraph, crowns: Map<string, Bounds>) => {
  const volumes: Bounds[] = [];
  const crown = (box: Bounds, centre: Point3) => {
    let cell = .15;
    // Coarse cells are wholly ABOVE the canonical2.1m traffic envelope (mounted witness max1.705m).
    if (graph.species === "maple-tree" && box.min[1] >= ROAD_DECORATION_OPENING.height) cell = .5;
    addCrownVolume(crowns, box, centre, cell);
  };
  for (const limb of graph.limbs) {
    // Centripetal curve overshoot and the bark's relief remain inside this conservative axis envelope.
    const padding = [0, 1, 2].map(axis => Math.max(...limb.path.slice(1).map((point, index) =>
      Math.abs(point[axis]! - limb.path[index]![axis]!))) * .5 + Math.max(limb.radius, limb.tipRadius) * 1.1);
    const box = {
      min: [0, 1, 2].map(axis => Math.min(...limb.path.map(point => point[axis]!)) - padding[axis]!) as Point3,
      max: [0, 1, 2].map(axis => Math.max(...limb.path.map(point => point[axis]!)) + padding[axis]!) as Point3
    };
    if (limb.role === "twig") crown(box, limb.path.at(-1)!); else volumes.push(box);
  }
  for (const leaf of graph.leaves) crown(pointBox(leaf.position, leaf.length + leaf.width), leaf.position);
  if (graph.species === "roadside-shrub") {
    // Both crossed far cards share this real shoot centre; include their transparent corner envelope.
    for (let shoot = 0; shoot < graph.leaves.length / 10; shoot++) {
      const centre = graph.leaves[shoot * 10 + 5]!.position;
      crown(pointBox(centre, Math.SQRT2 * ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE), centre);
    }
  }
  for (const flower of graph.blossoms) crown(pointBox(flower.position, flower.radius * 1.5), flower.position);
  if (graph.pot) {
    const { depth, height, width } = graph.pot;
    volumes.push({ min: [-width / 2 - .005, 0, -depth / 2 - .005],
      max: [width / 2 + .005, height + .005, depth / 2 + .005] });
  }
  return volumes;
};

export const ornamentalPlantClearanceVolumes = (asset: PlantDecorationAsset) => {
  const completion = catalogPlantClearance(asset);
  if (completion) return [...completion];
  const species = ornamentalPlantModel(asset);
  if (!species) return undefined;
  if (species === "willow-tree" || species === "cypress-tree")
    return romanGardenTreeClearanceVolumes(species, asset.variant);
  if (species === "flowering-peach") return floweringPeachClearanceVolumes(asset.variant);
  // Sub-walker leaf gaps share small conservative cells; both graphics tiers use this one physical union.
  const crowns = new Map<string, Bounds>();
  const structure = [true, false].flatMap(detailed => {
    if (species === "bonsai-elm") return graphVolumes(createBonsaiElmGraph(asset.variant, detailed), crowns);
    if (species === "maple-tree") return graphVolumes(createMapleTreeGraph(asset.variant, detailed), crowns);
    return graphVolumes(createRoadsideShrubGraph(asset.variant, detailed, asset.potted), crowns);
  });
  const exactStructure = new Map(structure.map(box => [`${box.min.join(":")}/${box.max.join(":")}`, box]));
  return [...exactStructure.values(), ...crowns.values()];
};
