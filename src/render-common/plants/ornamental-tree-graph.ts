import type { Point3 } from "../buildings/building-recipe";

export interface OrnamentalLimb {
  parent: number | null;
  path: Point3[];
  radius: number;
  tipRadius: number;
  role: "trunk" | "root" | "branch" | "twig";
}
export interface OrnamentalNeedleSpray {
  limb: number;
  tip: Point3;
  direction: Point3;
  length: number;
  seed: number;
}
export interface OrnamentalLeaf {
  position: Point3;
  yaw: number;
  pitch: number;
  roll: number;
  length: number;
  width: number;
  seed: number;
}
export interface OrnamentalBlossom {
  position: Point3;
  yaw: number;
  pitch: number;
  radius: number;
  seed: number;
}
export interface OrnamentalTreeGraph {
  species: "bonsai-pine" | "bonsai-elm" | "flowering-peach" | "maple-tree" | "roadside-shrub";
  variant: number;
  limbs: OrnamentalLimb[];
  needles: OrnamentalNeedleSpray[];
  leaves: OrnamentalLeaf[];
  blossoms: OrnamentalBlossom[];
  pot?: { style: "oval" | "rectangle" | "round"; width: number; depth: number; height: number };
}

export const ornamentalNoise = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
export const addOrnamentalLimb = (graph: OrnamentalTreeGraph, parent: number | null,
  path: Point3[], radius: number, tipRadius: number, role: OrnamentalLimb["role"]) => {
  const id = graph.limbs.length;
  graph.limbs.push({ parent, path, radius, tipRadius, role });
  return id;
};
export const ornamentalPointBetween = (first: Point3, last: Point3, t: number): Point3 =>
  first.map((value, axis) => value + (last[axis]! - value) * t) as Point3;

/** Branch starts use actual parent control points, so every woody joint has a physical bearing. */
export const ornamentalAnchor = (graph: OrnamentalTreeGraph, parent: number, index: number): Point3 =>
  [...graph.limbs[parent]!.path[index]!] as Point3;
