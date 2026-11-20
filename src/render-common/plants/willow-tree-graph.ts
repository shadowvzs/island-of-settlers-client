import { CatmullRomCurve3, Euler, Vector3 } from "three";

import type { Point3 } from "../buildings/building-recipe";
import { type OrnamentalLimb,ornamentalNoise } from "./ornamental-tree-graph";
import type { GardenTreeLeaf, RomanGardenTreeGraph } from "./roman-garden-tree-graph";

const point = (angle: number, reach: number, height: number, lean = 0): Point3 =>
  [Math.cos(angle) * reach + lean, height, Math.sin(angle) * reach];
const curve = (path: Point3[]) => new CatmullRomCurve3(path.map(value => new Vector3(...value)));
const append = (graph: RomanGardenTreeGraph, parent: number | null, path: Point3[],
  radius: number, tipRadius: number, role: OrnamentalLimb["role"]) => {
  graph.limbs.push({ parent, path, radius, role, tipRadius });
  return graph.limbs.length - 1;
};

/** Match the actual wood builder's arc-length taper when a smaller branch buds from its parent. */
const bearing = (graph: RomanGardenTreeGraph, parent: number, parameter: number) => {
  const support = graph.limbs[parent]!, centreline = curve(support.path);
  const lengths = centreline.getLengths(200), index = parameter * 200, lower = Math.floor(index);
  const fraction = (lengths[lower]! + (lengths[Math.min(200, lower + 1)]! - lengths[lower]!) *
    (index - lower)) / lengths[200]!;
  return { node: centreline.getPoint(parameter).toArray() as Point3,
    radius: support.radius * (1 - fraction) ** .95 + support.tipRadius * fraction };
};

/** Leaf blade, visible petiole and actual twig node have one authored relationship. */
const attachLeaf = (graph: RomanGardenTreeGraph,
  bearing: { limb: number; node: Point3; parameter: number }, angle: number, seed: number,
  detailed: boolean, upper = false) => {
  const { node } = bearing;
  const side = seed % 2 ? -1 : 1;
  const yaw = angle + side * (1.0 + ornamentalNoise(seed + 2) * .45);
  let pitch = .40 + ornamentalNoise(seed + 3) * .72;
  if (upper) pitch = -.14 + ornamentalNoise(seed + 3) * .65;
  const roll = side * (.12 + ornamentalNoise(seed + 4) * .30);
  const direction = new Vector3(0, 0, 1).applyEuler(new Euler(pitch, yaw, roll, "YXZ"));
  const length = .032 + ornamentalNoise(seed + 5) * .014;
  const position = new Vector3(...node).addScaledVector(direction, length).toArray() as Point3;
  const leaf: GardenTreeLeaf = { length: (detailed ? .27 : .33) + ornamentalNoise(seed + 6) * .055,
    petiole: { ...bearing, node: [...node] as Point3, radius: detailed ? .0022 : .0026 },
    pitch, position, roll, seed, width: detailed ? .062 : .082, yaw };
  graph.leaves.push(leaf);
};

const pendant = (graph: RomanGardenTreeGraph, parent: number, t: number,
  angle: number, seed: number, detailed: boolean) => {
  const support = bearing(graph, parent, t), start = support.node;
  const reach = .11 + ornamentalNoise(seed) * .16;
  const drop = 1.05 + ornamentalNoise(seed + 1) * 1.30;
  const path: Point3[] = [start,
    [start[0] + Math.cos(angle) * reach * .75, start[1] - drop * .20,
      start[2] + Math.sin(angle) * reach * .75],
    [start[0] + Math.cos(angle + .08) * reach, start[1] - drop * .61,
      start[2] + Math.sin(angle + .08) * reach],
    [start[0] + Math.cos(angle + .14) * reach * .83, start[1] - drop,
      start[2] + Math.sin(angle + .14) * reach * .83]];
  const radius = Math.min(.011, support.radius * .85);
  const id = append(graph, parent, path, radius, Math.min(.0025, radius * .30), "twig");
  const shoot = curve(graph.limbs[id]!.path), leaves = detailed ? 13 : 9;
  for (let leaf = 0; leaf < leaves; leaf++) {
    const parameter = .035 + leaf / leaves * .94;
    const node = shoot.getPoint(parameter).toArray() as Point3;
    attachLeaf(graph, { limb: id, node, parameter }, angle + leaf * .23, seed + leaf * 37, detailed);
  }
};

const secondaryFork = (graph: RomanGardenTreeGraph, parent: number, angle: number,
  index: number, seed: number, detailed: boolean) => {
  const support = bearing(graph, parent, .40 + index * .18), start = support.node;
  const yaw = angle + (index % 2 ? -1 : 1) * (.27 + index * .11);
  const reach = 1.18 + ornamentalNoise(seed) * .18;
  const tip = point(yaw, reach, start[1] - .12 + ornamentalNoise(seed + 1) * .12);
  const path: Point3[] = [start,
    [(start[0] * 2 + tip[0]) / 3, start[1] + .12, (start[2] * 2 + tip[2]) / 3],
    [(start[0] + tip[0] * 2) / 3, tip[1] + .15, (start[2] + tip[2] * 2) / 3], tip];
  const id = append(graph, parent, path, Math.min(.025, support.radius * .8), .004, "branch");
  const fork = curve(path), count = detailed ? 4 : 2;
  for (let leaf = 0; leaf < count; leaf++) {
    const parameter = .25 + leaf / count * .70;
    const node = fork.getPoint(parameter).toArray() as Point3;
    attachLeaf(graph, { limb: id, node, parameter }, yaw + leaf * .51, seed + leaf * 43, detailed, true);
  }
  for (let curtain = 0; curtain < 3; curtain++)
    pendant(graph, id, .43 + curtain * .275, yaw + (curtain - 1) * .36,
      seed + curtain * 193, detailed);
};

const archingBough = (graph: RomanGardenTreeGraph, parent: number, angle: number,
  index: number, seed: number, detailed: boolean) => {
  let parameter = .38 + index * .22;
  if (parent === 0) parameter = (5 + parameter * 4) / 9;
  const support = bearing(graph, parent, parameter), start = support.node;
  const yaw = angle + (index - 1) * .65 + (ornamentalNoise(seed) - .5) * .20;
  const reach = 1.05 + ornamentalNoise(seed + 1) * .22;
  const height = start[1] + .15 + ornamentalNoise(seed + 2) * .18;
  const tip = point(yaw, reach, height);
  const path: Point3[] = [start,
    [(start[0] * 2 + tip[0]) / 3, height + .21, (start[2] * 2 + tip[2]) / 3],
    [(start[0] + tip[0] * 2) / 3, height + .19, (start[2] + tip[2] * 2) / 3], tip];
  const id = append(graph, parent, path, Math.min(.048, support.radius * .8), .006, "branch");
  for (let fork = 0; fork < (detailed ? 3 : 2); fork++)
    secondaryFork(graph, id, yaw, fork, seed + fork * 137, detailed);
};

/** Three organic co-dominant leaders carry a rounded, hanging crown rather than horizontal spokes. */
export const createWillowTreeGraph = (detailed: boolean, variant: number): RomanGardenTreeGraph => {
  const graph: RomanGardenTreeGraph = { leaves: [], limbs: [], species: "willow-tree", variant };
  const lean = [0, .14, -.10][variant]!;
  const rise = [0, -.12, .16][variant]!;
  const trunk: Point3[] = [[0, -.08, 0], [.01, .16, -.01], [-.025, .75, .02],
    [lean * .25, 1.4, -.025], [lean * .6 + .015, 2.0, .025], [lean, 2.65 + rise, 0]];
  const leaderPaths = [0, 1, 2].map((leader): Point3[] => {
    const angle = leader * 2.16 + variant * .42;
    const start = trunk[leader + 3]!;
    const height = 3.35 + leader * .13 + rise;
    return [start,
      point(angle, .15, start[1] + .45, lean * .55),
      point(angle + .10, .38, height - .48, lean * .70),
      point(angle + .17, .58, height - .15, lean * .85),
      point(angle + .22, .64, height, lean)];
  });
  // The trunk flows into its final leader as one continuous surface, avoiding an exposed cut cap at the fork.
  trunk.push(...leaderPaths[2]!.slice(1));
  append(graph, null, trunk, .225, .009, "trunk");
  for (let root = 0; root < 7; root++) {
    const angle = root * 2.399963 + variant;
    append(graph, 0, [trunk[1]!, point(angle, .27, .07), point(angle + .10, .51, -.04)],
      .075, .010, "root");
  }
  for (let leader = 0; leader < 3; leader++) {
    const angle = leader * 2.16 + variant * .42;
    const path = leaderPaths[leader]!;
    let id = 0;
    if (leader < 2) id = append(graph, 0, path, .100 - leader * .014, .009, "branch");
    const leaderCurve = curve(graph.limbs[id]!.path), upperLeaves = detailed ? 8 : 4;
    for (let leaf = 0; leaf < upperLeaves; leaf++) {
      let parameter = .65 + leaf / upperLeaves * .32;
      if (leader === 2) parameter = (5 + parameter * 4) / 9;
      const node = leaderCurve.getPoint(parameter).toArray() as Point3;
      attachLeaf(graph, { limb: id, node, parameter }, angle + leaf * 1.9,
        19000 + leader * 173 + leaf * 23, detailed, true);
    }
    for (let bough = 0; bough < (detailed ? 3 : 2); bough++)
      archingBough(graph, id, angle, bough, leader * 5003 + bough * 337 + variant * 10007, detailed);
  }
  return graph;
};
