import type { Point3 } from "../buildings/building-recipe";
import {
  addOrnamentalLimb, ornamentalAnchor,   type OrnamentalLeaf, ornamentalNoise, ornamentalPointBetween,
type OrnamentalTreeGraph
} from "./ornamental-tree-graph";

/** Far card half-size is also part of the backend-neutral visual clearance envelope. */
export const ROAD_SHRUB_FAR_CLUSTER_HALF_SIZE = .070;

const normalize = (point: Point3): Point3 => {
  const length = Math.hypot(...point);
  return point.map(value => value / length) as Point3;
};
const cross = (a: Point3, b: Point3): Point3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The blade normal faces the crown exterior; its long axis varies naturally within that plane. */
const leafPose = (normal: Point3, spin: number) => {
  const reference: Point3 = Math.abs(normal[1]) > .95 ? [1, 0, 0] : [0, 1, 0];
  const side = normalize(cross(normal, reference)), up = cross(side, normal);
  const forward = up.map((value, axis) => value * Math.cos(spin) + side[axis]! * Math.sin(spin)) as Point3;
  const right = cross(normal, forward);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -forward[1])));
  return { pitch, yaw: Math.atan2(forward[0], forward[2]), roll: Math.atan2(right[1], normal[1]) };
};

const leavesOnShoot = (graph: OrnamentalTreeGraph, start: Point3, end: Point3, normal: Point3,
  seed: number, variant: number) => {
  for (let leaf = 0; leaf < 10; leaf++) {
    const noise = ornamentalNoise(seed + leaf * 19);
    const position = ornamentalPointBetween(start, end, .10 + leaf / 10 * .89);
    const direction = normalize(normal.map((value, axis) =>
      value + (ornamentalNoise(seed + leaf * 13 + axis * 73) - .5) * .65) as Point3);
    const pose = leafPose(direction, leaf * 2.399963 + seed * .07);
    const shape: Pick<OrnamentalLeaf, "length" | "width"> = {
      length: (variant === 1 ? .055 : .062) * (.84 + noise * .28),
      width: (variant === 1 ? .029 : .039) * (.87 + noise * .22)
    };
    graph.leaves.push({ position, ...pose, ...shape, seed: seed + leaf * 19 });
  }
};

/** Dense boxwood, upright myrtle and flowering myrtle studies, not aliases for the entire plant catalogue. */
export const createRoadsideShrubGraph = (variant = 0, detailed = true, potted = false): OrnamentalTreeGraph => {
  if (![0, 1, 2].includes(variant)) throw new Error("Unknown roadside shrub structure");
  const pot = { style: "round" as const, width: .50, depth: .50, height: .28 };
  const graph: OrnamentalTreeGraph = { species: "roadside-shrub", variant,
    limbs: [], needles: [], leaves: [], blossoms: [] };
  if (potted) graph.pot = pot;
  const base = potted ? pot.height - .024 : 0;
  const height = [.58, .86, .66][variant]!, radius = [.28, .22, .30][variant]!;
  const centre = height * .56, vertical = height * .43;
  const root = addOrnamentalLimb(graph, null,
    [[0, base - .025, 0], [.003, base + .05, -.004], [0, base + .115, 0]], .022, .013, "trunk");
  const branches: number[] = [];
  for (let stem = 0; stem < 7; stem++) {
    const angle = stem * 2.399963 + variant * .57;
    const start = ornamentalAnchor(graph, root, stem % 2 + 1);
    const reach = variant === 1 ? height * (.29 + stem / 6 * .54) :
      centre + (ornamentalNoise(stem * 41) - .5) * vertical * .72;
    const tip: Point3 = [Math.cos(angle) * radius * .47,
      base + reach,
      Math.sin(angle) * radius * .47];
    const middle = ornamentalPointBetween(start, tip, .53); middle[1] += .025;
    middle[0] += Math.sin(angle) * .013; middle[2] -= Math.cos(angle) * .013;
    const lower = ornamentalPointBetween(start, middle, .54), upper = ornamentalPointBetween(middle, tip, .52);
    branches.push(addOrnamentalLimb(graph, root, [start, lower, middle, upper, tip],
      .0095 + ornamentalNoise(stem * 31) * .0015, .0038, "branch"));
  }
  const shoots = 64;
  for (let shoot = 0; shoot < shoots; shoot++) {
    const seed = variant * 10000 + shoot * 47;
    const latitude = 1 - 2 * (shoot + .5) / shoots;
    const radial = Math.sqrt(1 - latitude * latitude), yaw = shoot * 2.399963 + variant * .57;
    const depth = .90 + ornamentalNoise(seed) * .10;
    const end: Point3 = [Math.cos(yaw) * radial * radius * depth,
      base + centre + latitude * vertical * depth, Math.sin(yaw) * radial * radius * depth];
    const distance = (branch: number) => Math.min(...graph.limbs[branch]!.path.slice(1).map(point =>
      point.reduce((sum, value, axis) => sum + (value - end[axis]!) ** 2, 0)));
    const parent = branches.reduce((best, branch) => distance(branch) < distance(best) ? branch : best);
    const path = graph.limbs[parent]!.path;
    const bearing = path.slice(1).reduce((best, point, index) => {
      const distance = (candidate: Point3) => candidate.reduce((sum, value, axis) => sum + (value - end[axis]!) ** 2, 0);
      return distance(point) < distance(path[best]!) ? index + 1 : best;
    }, 1);
    const origin = ornamentalAnchor(graph, parent, bearing);
    const middle = ornamentalPointBetween(origin, end, .69);
    middle[0] += Math.cos(yaw + Math.PI / 2) * .014;
    middle[1] += .008; middle[2] += Math.sin(yaw + Math.PI / 2) * .014;
    addOrnamentalLimb(graph, parent, [origin, middle, end], .0040 + ornamentalNoise(seed + 7) * .0012,
      .00065 + ornamentalNoise(seed + 11) * .00025, "twig");
    const normal = normalize([end[0] / radius ** 2, (end[1] - base - centre) / vertical ** 2,
      end[2] / radius ** 2]);
    leavesOnShoot(graph, middle, end, normal, seed, variant);
    if (variant === 2 && shoot % (detailed ? 2 : 3) === 0) graph.blossoms.push({ position: end, yaw: Math.atan2(normal[0], normal[2]),
      pitch: Math.acos(normal[1]), radius: .014 + ornamentalNoise(seed + 2) * .003, seed });
  }
  return graph;
};
