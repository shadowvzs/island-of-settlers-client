import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import { type BambooGroveSpecies, type BambooGroveVariant, bambooMoundRadius,
  bambooSpecies } from "./bamboo-grove-species";
import { addSprayLeaves, type BambooLeaf, bambooRandom, type BambooRandom, normalize3,
  offset3 } from "./bamboo-grove-spray";

export type { BambooLeaf } from "./bamboo-grove-spray";

export interface BambooCulm {
  /** Unit horizontal direction the culm leans and arches towards. */
  outward: Point3;
  /** Node centres from the buried base (index 0) to the tip (last). */
  nodes: Point3[];
  /** Wind phase: neighbouring culms sway out of step. */
  phase: number;
  /** Outer radius at each node. */
  radii: number[];
  /** Normalised height fraction at each node (also the wind bend basis). */
  heights: number[];
}
/** A branch or twig tube: start on its parent surface, a drooping polyline outward. */
export interface BambooBranch {
  bend: number;
  culm: number;
  points: Point3[];
  radius: readonly [start: number, end: number];
  twig: boolean;
}
export interface BambooSheath { culm: number; node: number; length: number; yaw: number }
export interface BambooShoot { base: Point3; height: number; radius: number }
export interface BambooLitter { position: Point3; yaw: number; length: number; width: number }
export interface BambooGroveGraph {
  branches: BambooBranch[];
  culms: BambooCulm[];
  leaves: BambooLeaf[];
  litter: BambooLitter[];
  sheaths: BambooSheath[];
  shoots: BambooShoot[];
  species: BambooGroveSpecies;
}

const GOLDEN_ANGLE = 2.399963;
const UP: Point3 = [0, 1, 0];

/** Short basal and apical internodes, long mid-culm ones, as in real culms. */
const nodeFractions = (count: number) => {
  const weights = Array.from({ length: count }, (_, index) =>
    .35 + DMath.sin(Math.PI * Math.min(1, (index + .5) / count * 1.25)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const fractions = [0];
  for (const weight of weights) fractions.push(fractions.at(-1)! + weight / total);
  return fractions;
};

const createCulm = (species: BambooGroveSpecies, index: number, random: BambooRandom): BambooCulm => {
  const ring = Math.sqrt((index + .5) / species.culms), angle = index * GOLDEN_ANGLE + random() * .4;
  const base: Point3 = [DMath.cos(angle) * species.clumpRadius * ring, -.03,
    DMath.sin(angle) * species.clumpRadius * ring];
  const outwardAngle = angle + (random() - .5) * .9;
  const outward: Point3 = [DMath.cos(outwardAngle), 0, DMath.sin(outwardAngle)];
  const [low, high] = species.height;
  const length = (high - (high - low) * ring * .7) * (.92 + random() * .1);
  const lean = species.lean * (.6 + ring * .8), arch = species.arch * (.75 + random() * .5);
  const r0 = species.radius[0] + (species.radius[1] - species.radius[0]) * (1 - ring * .6) * random();
  const fractions = nodeFractions(Math.max(9, Math.round(length / species.internode)));
  const nodes = fractions.map((t): Point3 => {
    const reach = length * (lean * t + arch * t ** 2.6);
    return [base[0] + outward[0] * reach, base[1] + length * t - .5 * arch * length * t ** 4,
      base[2] + outward[2] * reach];
  });
  return { outward, nodes, phase: random() * 6.283, heights: fractions,
    radii: fractions.map(t => r0 * (1 - .68 * t ** 1.6)) };
};

/** Alternate nodes carry the full whorl or one dominant branch (real culms are not evenly bristled). */
const branchSpread = (species: BambooGroveSpecies, node: number) => {
  // A lone showpiece culm carries full whorls on every node.
  if (node % 2 && species.form === "clump") return [0];
  const count = species.branchesPerNode;
  return count === 2 ? [-.42, .42] : [-.75, 0, .75];
};

/** Drooping tube: rises from the parent, then sags under its leaf spray. */
const branchPoints = (start: Point3, direction: Point3, length: number): Point3[] => [
  start, offset3(offset3(start, direction, length * .5), UP, length * .05),
  offset3(offset3(start, direction, length), UP, -length * .1)];

const addBranch = (graph: BambooGroveGraph, culmIndex: number, node: number, yaw: number,
  random: BambooRandom) => {
  const { species } = graph, culm = graph.culms[culmIndex]!;
  const t = culm.heights[node]!, bend = t * t;
  const elevation = .55 + random() * .3, radial: Point3 = [DMath.cos(yaw), 0, DMath.sin(yaw)];
  const direction = normalize3([radial[0] * DMath.cos(elevation), DMath.sin(elevation),
    radial[2] * DMath.cos(elevation)]);
  const reach = (t - species.whorlStart) / (1 - species.whorlStart);
  const length = species.branchLength * (1.05 - .55 * reach) * (.82 + random() * .3);
  const start = offset3(culm.nodes[node]!, radial, culm.radii[node]! * .8);
  const points = branchPoints(start, direction, length);
  graph.branches.push({ bend, culm: culmIndex, points, radius: [Math.max(.008, culm.radii[node]! * .3), .0045],
    twig: false });
  addSprayLeaves(graph.leaves, { axis: normalize3([direction[0], -.15, direction[2]]), bend, culm: culmIndex,
    count: species.sprayLeaves, origin: points[2]!, species }, random);
  if (length < .45) return;
  // A lone culm fills its crown with twig sprays on both sides; clump culms carry one.
  const sides = species.form === "single" ? [-.85, .85] : [random() < .5 ? -.85 : .85];
  for (const side of sides) addTwig(graph, culmIndex, bend, points[1]!, yaw + side, random);
};

const addTwig = (graph: BambooGroveGraph, culmIndex: number, bend: number, start: Point3, yaw: number,
  random: BambooRandom) => {
  const { species } = graph;
  const direction = normalize3([DMath.cos(yaw), .3, DMath.sin(yaw)]);
  const twig = branchPoints(start, direction, .15 + random() * .08);
  graph.branches.push({ bend, culm: culmIndex, points: twig, radius: [.0055, .0035], twig: true });
  addSprayLeaves(graph.leaves, { axis: normalize3([direction[0], -.15, direction[2]]), bend,
    culm: culmIndex, count: species.sprayLeaves - 1, origin: twig[2]!, species, twig: true }, random);
};

const addCulmFoliage = (graph: BambooGroveGraph, culmIndex: number, random: BambooRandom) => {
  const { species } = graph, culm = graph.culms[culmIndex]!, last = culm.nodes.length - 1;
  const yawSeed = random() * 6.283;
  // Mature culms shed their sheaths: up to a few persist on the lowest nodes of younger culms.
  let sheathed = Math.floor(random() * (1 + species.sheathedFraction * 10));
  if (species.form === "single") sheathed = Math.max(2, sheathed);
  for (let node = 1; node < last; node++) {
    const t = culm.heights[node]!;
    if (t < species.whorlStart) {
      // Sheath tops stay below the next node collar (v 0.93): the swelling culm never shows through.
      if (node <= sheathed) graph.sheaths.push({ culm: culmIndex, node,
        length: (culm.nodes[node + 1]![1] - culm.nodes[node]![1]) * (.55 + random() * .22), yaw: random() * 6.283 });
      continue;
    }
    const turn = species.form === "single" ? GOLDEN_ANGLE : Math.PI;
    const yaw = yawSeed + node * turn + (random() - .5) * .5;
    for (const spread of branchSpread(species, node))
      addBranch(graph, culmIndex, node, yaw + spread, random);
  }
  const tip = culm.nodes[last]!, below = culm.nodes[last - 1]!;
  addSprayLeaves(graph.leaves, { axis: normalize3([tip[0] - below[0], tip[1] - below[1], tip[2] - below[2]]),
    bend: 1, culm: culmIndex, count: species.sprayLeaves + 1, origin: tip, species }, random);
};

const addGround = (graph: BambooGroveGraph, random: BambooRandom) => {
  const { species } = graph;
  for (let index = 0; index < species.shoots; index++) {
    const angle = random() * 6.283;
    const reach = Math.max(species.clumpRadius, species.radius[1] * 2.6) * (.95 + random() * .2);
    graph.shoots.push({ base: [DMath.cos(angle) * reach, -.02, DMath.sin(angle) * reach],
      height: .34 + random() * .24, radius: species.radius[1] * (.75 + random() * .25) });
  }
  for (let index = 0; index < 14; index++) {
    const angle = index * GOLDEN_ANGLE, reach = (bambooMoundRadius(species) - .15) * Math.sqrt(random());
    graph.litter.push({ position: [DMath.cos(angle) * reach, .012, DMath.sin(angle) * reach],
      yaw: random() * 6.283, length: species.leafLength * .85, width: species.leafWidth });
  }
};

const graphs = new Map<BambooGroveVariant, BambooGroveGraph>();

/** The one structural truth of a grove: every render tier and the physical reservation read it. */
export const createBambooGroveGraph = (variant: BambooGroveVariant): BambooGroveGraph => {
  const cached = graphs.get(variant);
  if (cached) return cached;
  const species = bambooSpecies(variant);
  const random = bambooRandom(9173 + variant * 7919);
  const graph: BambooGroveGraph = { branches: [], culms: [], leaves: [], litter: [], sheaths: [], shoots: [], species };
  for (let index = 0; index < species.culms; index++) graph.culms.push(createCulm(species, index, random));
  graph.culms.forEach((_, index) => addCulmFoliage(graph, index, random));
  addGround(graph, random);
  graphs.set(variant, graph);
  return graph;
};
