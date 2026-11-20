import { createFloweringPeachGraph } from "./flowering-peach-graph";
import { createMapleTreeGraph } from "./maple-tree-graph";
import type { OrnamentalLimb } from "./ornamental-tree-graph";

export type FloweringSpecies = "cherry-blossom" | "white-cherry" | "white-peach" |
  "double-peach" | "pink-peach" | "red-maple";
export type FloweringPoint = [number, number, number];
export interface FloweringLimb {
  points: FloweringPoint[];
  radius: number;
  tip: number;
  role: OrnamentalLimb["role"];
}
export interface FloweringShoot { start: FloweringPoint; end: FloweringPoint; seed: number }
export const floweringNoise = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
export const floweringMix = (a: FloweringPoint, b: FloweringPoint, t: number): FloweringPoint =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** New ornamental cultivars borrow proven organic wood anatomy; approved source graphs remain immutable. */
export const createCatalogFloweringGraph = (species: FloweringSpecies, variant: number, roadside: boolean,
  detailed: boolean) => {
  const cherry = species.includes("cherry"), maple = species === "red-maple";
  const source = cherry || maple ? createMapleTreeGraph(variant, false) : createFloweringPeachGraph(variant, false);
  const height = { "cherry-blossom": 3.35, "white-cherry": 3.2, "white-peach": 3.15,
    "double-peach": 3.3, "pink-peach": 3.25, "red-maple": 3.3 }[species];
  let sourceHeight = 0, sourceRadius = 0;
  for (const limb of source.limbs) for (const point of limb.path) {
    sourceHeight = Math.max(sourceHeight, point[1]);
    sourceRadius = Math.max(sourceRadius, Math.hypot(point[0], point[2]));
  }
  const primaryOrigins = source.limbs.filter(limb => limb.role === "branch" && limb.parent === 0);
  const forkHeight = Math.min(...primaryOrigins.map(limb => limb.path[0]![1]));
  const formHeight = height * [.97, .94, 1][variant]! - .20;
  const crownWidth = [1.0, 1.05, .93][variant]!;
  const radialScale = (roadside ? .36 : crownWidth) / sourceRadius;
  const rotation = species === "white-cherry" ? .36 : 0;
  const verticalScale = formHeight / sourceHeight;
  const transform = (point: FloweringPoint, root = false): FloweringPoint => {
    let y = point[1] * verticalScale;
    if (point[1] < 0 || root) y = point[1] * .35;
    else if (roadside) {
      y = point[1] / forkHeight * 2.24;
      if (point[1] > forkHeight)
        y = 2.24 + (point[1] - forkHeight) / (sourceHeight - forkHeight) * (formHeight - 2.24);
    }
    return [(point[0] * Math.cos(rotation) - point[2] * Math.sin(rotation)) * radialScale,
      y, (point[0] * Math.sin(rotation) + point[2] * Math.cos(rotation)) * radialScale];
  };
  const candidates = source.limbs.flatMap((limb, index) => {
    if (limb.role !== "twig" || limb.parent === null) return [];
    if (source.limbs[limb.parent]!.role === "twig") return [];
    return [index];
  });
  let target = detailed ? 104 : 40;
  if (species === "double-peach") target = detailed ? 64 : 30;
  if (maple) target = detailed ? 140 : 70;
  const selected = new Set<number>();
  for (let index = 0; index < Math.min(target, candidates.length); index++)
    selected.add(candidates[Math.floor(index * candidates.length / Math.min(target, candidates.length))]!);
  const needed = new Set(selected);
  if (!detailed) for (const selectedIndex of selected) {
    let parent = source.limbs[selectedIndex]!.parent;
    while (parent !== null) { needed.add(parent); parent = source.limbs[parent]!.parent; }
  }
  const limbs: FloweringLimb[] = [], shoots: FloweringShoot[] = [];
  const thickness = roadside ? .37 : .48;
  for (const [index, limb] of source.limbs.entries()) {
    if (limb.role === "twig" && !selected.has(index)) continue;
    if (!detailed && limb.role !== "root" && !needed.has(index)) continue;
    let path = limb.path;
    if (!detailed && limb.role !== "root" && limb.role !== "twig") {
      let lastBearing = 0;
      for (const [childIndex, child] of source.limbs.entries()) {
        if (!needed.has(childIndex) || child.parent !== index) continue;
        const bearing = path.findIndex(point => point.every((coordinate, axis) =>
          Math.abs(coordinate - child.path[0]![axis]!) < 1e-8));
        lastBearing = Math.max(lastBearing, bearing);
      }
      if (lastBearing > 0) path = path.slice(0, lastBearing + 1);
    }
    const points = path.map(point => transform(point, limb.role === "root"));
    const radius = Math.max(limb.role === "twig" ? .0045 : .008, limb.radius * thickness);
    const tip = Math.max(limb.role === "twig" ? .002 : .003, limb.tipRadius * thickness);
    limbs.push({ points, radius, role: limb.role, tip });
    if (!selected.has(index)) continue;
    shoots.push({ start: points[points.length - 2]!, end: points[points.length - 1]!, seed: index * 17 + variant * 101 });
  }
  return { height, limbs, shoots };
};
