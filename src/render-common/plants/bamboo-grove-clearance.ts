import type { Point3 } from "../buildings/building-recipe";
import { createBambooGroveGraph } from "./bamboo-grove-graph";
import { bambooMoundRadius, type BambooGroveVariant } from "./bamboo-grove-species";
import { offset3 } from "./bamboo-grove-spray";

interface Box { min: Point3; max: Point3 }

/** Outward centimetre rounding: the reservation never depends on a last-bit difference. */
const rounded = ({ max, min }: Box): Box => ({
  max: max.map(value => Math.ceil(value * 100) / 100) as Point3,
  min: min.map(value => Math.floor(value * 100) / 100) as Point3
});

const boxAround = (points: readonly Point3[], reach: number): Box => {
  const min = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]!)) - reach) as Point3;
  const max = [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]!)) + reach) as Point3;
  min[1] = Math.max(0, min[1]);
  return { min, max };
};

/** Culm boxes in short runs keep the trunk zone narrow; one crown box covers branches and leaf tips. */
export const bambooGroveClearanceVolumes = (variant: BambooGroveVariant): Box[] => {
  const graph = createBambooGroveGraph(variant), volumes: Box[] = [];
  for (const culm of graph.culms) for (let start = 0; start < culm.nodes.length - 1; start += 4) {
    const run = culm.nodes.slice(start, start + 5);
    volumes.push(boxAround(run, culm.radii[start]! * 1.15 + .02));
  }
  for (const shoot of graph.shoots)
    volumes.push(boxAround([shoot.base, offset3(shoot.base, [0, 1, 0], shoot.height)], shoot.radius * 1.3));
  const mound = bambooMoundRadius(graph.species);
  volumes.push({ min: [-mound, 0, -mound], max: [mound, .06, mound] });
  const crown = [...graph.branches.flatMap(branch => branch.points),
    ...graph.leaves.flatMap(leaf => [leaf.base, offset3(leaf.base, leaf.direction, leaf.length)])];
  volumes.push(boxAround(crown, .05));
  return volumes.map(rounded);
};
