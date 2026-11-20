import type { Point3 } from "../buildings/building-recipe";
import { createRomanGardenTreeGraph, type RomanGardenTreeSpecies } from "./roman-garden-tree-graph";

/** Union of both botanical meshes and reduced far blades; independent of the selected graphics detail. */
export const romanGardenTreeClearanceVolumes = (species: RomanGardenTreeSpecies, variant: number) => {
  const volumes: { min: Point3; max: Point3 }[] = [];
  const crowns = new Map<string, { min: Point3; max: Point3 }>();
  for (const detailed of [true, false]) {
    const graph = createRomanGardenTreeGraph(species, detailed, variant);
    for (const limb of graph.limbs) {
      const padding = Math.max(limb.radius, limb.tipRadius) * 1.1;
      // Catmull-Rom's control interval can overshoot; include half the longest adjacent interval per axis.
      const extent = [0, 1, 2].map(axis => Math.max(...limb.path.slice(1).map((point, index) =>
        Math.abs(point[axis]! - limb.path[index]![axis]!))) * .5 + padding);
      volumes.push({ min: [0, 1, 2].map(axis =>
        Math.min(...limb.path.map(point => point[axis]!)) - extent[axis]!) as Point3,
      max: [0, 1, 2].map(axis => Math.max(...limb.path.map(point => point[axis]!)) + extent[axis]!) as Point3 });
    }
    for (const leaf of graph.leaves) {
      const radius = leaf.length * 1.4 + leaf.width * 1.7;
      const key = leaf.position.map(value => Math.floor(value / .18)).join(":");
      const bounds = { min: leaf.position.map(value => value - radius) as Point3,
        max: leaf.position.map(value => value + radius) as Point3 };
      const existing = crowns.get(key);
      if (!existing) { crowns.set(key, bounds); continue; }
      for (const axis of [0, 1, 2]) {
        existing.min[axis] = Math.min(existing.min[axis]!, bounds.min[axis]!);
        existing.max[axis] = Math.max(existing.max[axis]!, bounds.max[axis]!);
      }
    }
  }
  return [...volumes, ...crowns.values()];
};
