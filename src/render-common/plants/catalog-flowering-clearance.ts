import { createCatalogFloweringGraph, type FloweringPoint, type FloweringSpecies } from "./catalog-flowering-graph";

interface FloweringClearanceAsset { species: string; variant: number; form: string; potted?: boolean }
interface FloweringClearanceBox { min: FloweringPoint; max: FloweringPoint }
const envelope = (points: FloweringPoint[], horizontal: number, vertical = horizontal): FloweringClearanceBox => {
  const min: FloweringPoint = [Infinity, Infinity, Infinity];
  const max: FloweringPoint = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    const expansion = (axis === 1 ? vertical : horizontal) + .00001;
    min[axis] = Math.min(min[axis]!, point[axis]! - expansion);
    max[axis] = Math.max(max[axis]!, point[axis]! + expansion);
  }
  return { min, max };
};
/** Authored near High/Minimal and distant surfaces share these exact bearing graphs. */
export const catalogFloweringClearance = (asset: FloweringClearanceAsset): readonly FloweringClearanceBox[] => {
  if (asset.potted) return [];
  const species = asset.species as FloweringSpecies;
  const roadside = asset.form === "roadside";
  const boxes: FloweringClearanceBox[] = [];
  for (const detailed of [true, false]) {
    const graph = createCatalogFloweringGraph(species, asset.variant, roadside, detailed);
    for (const limb of graph.limbs) boxes.push(envelope(limb.points, limb.radius * 1.12));
    for (const shoot of graph.shoots) boxes.push(envelope([shoot.start, shoot.end], roadside ? .235 : .26, .25));

  }
  return boxes;
};
