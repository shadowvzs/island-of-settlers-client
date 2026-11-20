import type { Point3 } from "../buildings/building-recipe";
import { createFloweringPeachGraph, type PeachTreeGraph } from "./flowering-peach-graph";

export interface PeachPhysicalBounds { min: Point3; max: Point3 }

const emptyBounds = (): PeachPhysicalBounds => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const include = (bounds: PeachPhysicalBounds, point: Point3, radius = 0) => {
  for (const axis of [0, 1, 2] as const) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis] - radius);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis] + radius);
  }
};

/** Canonical capture layout; pure graph math shared by rendering and physical clearance. */
export const createPeachCrownLayout = (graph: PeachTreeGraph) => graph.crownGroups.map(group => {
  const bounds = emptyBounds();
  for (let index = group.limbStart; index < group.limbEnd; index++) {
    const limb = graph.limbs[index]!;
    if (limb.role === "twig") limb.path.forEach(point => include(bounds, point));
  }
  for (let index = group.leafStart; index < group.leafEnd; index++) {
    const leaf = graph.leaves[index]!; include(bounds, leaf.position, leaf.length);
  }
  for (let index = group.flowerStart; index < group.flowerEnd; index++) include(bounds, graph.blossoms[index]!.position);
  const centre = bounds.min.map((value, axis) => (value + bounds.max[axis]!) * .5) as Point3;
  const size = bounds.min.map((value, axis) => bounds.max[axis]! - value);
  const radius = Math.sqrt(size[0]! * size[0]! + size[1]! * size[1]! + size[2]! * size[2]!) * .53;
  return { centre, radius };
});

/** One camera/quality-independent identity; transparent full-tree far padding is not a solid wall. */
export const floweringPeachClearanceVolumes = (variant = 0): PeachPhysicalBounds[] => {
  const graph = createFloweringPeachGraph(variant, true);
  const structure = graph.limbs.filter(limb => limb.role !== "twig").map(limb => {
    const bounds = emptyBounds();
    // Enclose centripetal interpolation overshoot and millimetre bark relief without GPU imports.
    const padding = [0, 1, 2].map(axis => Math.max(...limb.path.slice(1).map((point, index) =>
      Math.abs(point[axis]! - limb.path[index]![axis]!))) * .5 + Math.max(limb.radius, limb.tipRadius) * 1.1);
    for (const point of limb.path) for (const axis of [0, 1, 2] as const) {
      bounds.min[axis] = Math.min(bounds.min[axis], point[axis] - padding[axis]!);
      bounds.max[axis] = Math.max(bounds.max[axis], point[axis] + padding[axis]!);
    }
    bounds.min[1] = Math.max(0, bounds.min[1]);
    return bounds;
  });
  const crowns = createPeachCrownLayout(graph).map(({ centre, radius }) => {
    const bounds = emptyBounds();
    // A square mass rotates with the camera; its corner reaches sqrt(2) times its half-size.
    include(bounds, centre, Math.SQRT2 * radius); bounds.min[1] = Math.max(0, bounds.min[1]);
    return bounds;
  });
  return [...structure, ...crowns];
};
