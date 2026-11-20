import type { Point3 } from "../buildings/building-recipe";
import { type OrnamentalLeaf, type OrnamentalLimb,ornamentalNoise } from "./ornamental-tree-graph";
import { createWillowTreeGraph } from "./willow-tree-graph";

export interface GardenTreeLeaf extends OrnamentalLeaf {
  petiole?: { limb: number; node: Point3; parameter: number; radius: number };
}

export type RomanGardenTreeSpecies = "willow-tree" | "cypress-tree";
export interface RomanGardenTreeGraph {
  species: RomanGardenTreeSpecies;
  variant: number;
  limbs: OrnamentalLimb[];
  leaves: GardenTreeLeaf[];
}

const limb = (graph: RomanGardenTreeGraph, parent: number | null, path: Point3[],
  radius: number, tipRadius: number, role: OrnamentalLimb["role"]) => {
  graph.limbs.push({ parent, path, radius, tipRadius, role });
  return graph.limbs.length - 1;
};
const polar = (angle: number, radius: number, y: number): Point3 =>
  [Math.cos(angle) * radius, y, Math.sin(angle) * radius];

const roots = (graph: RomanGardenTreeGraph, radius: number) => {
  for (let index = 0; index < 7; index++) {
    const angle = index * 2.39996 + graph.variant;
    limb(graph, 0, [[0, .13, 0], polar(angle, radius * .50, .07), polar(angle + .12, radius, -.04)],
      radius * .16, .012, "root");
  }
};

const cypress = (graph: RomanGardenTreeGraph, detailed: boolean) => {
  const height = 4.25 + graph.variant * .10;
  limb(graph, null, [[0, -.05, 0], [0, .16, 0], [.012, 1.8, 0], [-.012, 3.3, .012], [0, height, 0]],
    .095, .003, "trunk");
  roots(graph, .20);
  const levels = detailed ? 27 : 17, branches = detailed ? 7 : 5;
  for (let level = 0; level < levels; level++) {
    const t = level / levels;
    const radius = .36 * Math.sin(Math.PI * (.16 + t * .84)) ** .57;
    for (let branch = 0; branch < branches; branch++) {
      const seed = level * 173 + branch * 19 + graph.variant * 137;
      const y = .33 + t * (height - .35) + (ornamentalNoise(seed + 3) - .5) * .13;
      const angle = branch * Math.PI * 2 / branches + level * 2.39996 + graph.variant +
        (ornamentalNoise(seed + 4) - .5) * .87;
      const reach = radius * (.84 + ornamentalNoise(seed) * .18);
      const end = polar(angle, reach, Math.min(height, y + .23));
      const branchId = limb(graph, 0, [[0, y - .07, 0], polar(angle, reach * .6, y + .06), end],
        .009 * (1 - t * .75), .0015, "twig");
      const upperTaper = Math.max(.30, Math.min(1, (1 - t) * 3));
      for (let fan = 0; fan < 3; fan++) for (let scale = 0; scale < (detailed ? 3 : 2); scale++) {
        const blend = .40 + scale * .17;
        const yaw = angle + (fan - 1) * .47;
        graph.leaves.push({ position: [end[0] * blend, y + .10 + scale * .031, end[2] * blend],
          length: (detailed ? .29 : .38) * upperTaper, width: (detailed ? .13 : .18) * upperTaper,
          pitch: -1.16 + fan * .07,
          roll: (fan - 1) * .35, yaw: Math.PI / 2 - yaw, seed: seed + fan * 13 + scale });
      }
      // Every foliage fan overlaps its actual ascending, woody shoot rather than floating around the leader.
      graph.limbs[branchId]!.parent = 0;
    }
  }
};

export const createRomanGardenTreeGraph = (species: RomanGardenTreeSpecies, detailed: boolean, variant = 0) => {
  if (!Number.isInteger(variant) || variant < 0 || variant > 2) throw new Error("Unknown garden tree form");
  if (species === "willow-tree") return createWillowTreeGraph(detailed, variant);
  const graph: RomanGardenTreeGraph = { leaves: [], limbs: [], species, variant };
  cypress(graph, detailed);
  return graph;
};
