import type { Point3 } from "../buildings/building-recipe";
import {
  addOrnamentalLimb,
  ornamentalAnchor,
  ornamentalNoise,
  ornamentalPointBetween,
  type OrnamentalTreeGraph
} from "./ornamental-tree-graph";

const GOLDEN_ANGLE = 2.399963229728653;

/** Ornamental maple identity: these trees never join forestry, harvest or resource state. */
export const MAPLE_TREE_FORMS = ["upright-broad", "asymmetric-spreading", "high-rounded"] as const;

const point = (angle: number, reach: number, height: number, lean = 0): Point3 =>
  [Math.cos(angle) * reach + lean, height, Math.sin(angle) * reach];

const addRoots = (graph: OrnamentalTreeGraph) => {
  for (let root = 0; root < 8; root++) {
    const angle = root * GOLDEN_ANGLE + graph.variant * .53;
    const reach = .61 + ornamentalNoise(root * 13 + graph.variant * 19) * .38;
    const radius = .10 + ornamentalNoise(root * 29 + graph.variant * 41) * .055;
    addOrnamentalLimb(graph, 0, [ornamentalAnchor(graph, 0, 1),
      point(angle, .29, .12), point(angle + .06, reach * .72, .025),
      point(angle + .11, reach, -.10)], radius, .011, "root");
  }
};

const leafShoot = (graph: OrnamentalTreeGraph, parent: number, index: number,
  angle: number, seed: number, detailed: boolean) => {
  const origin = ornamentalAnchor(graph, parent, index);
  const yaw = angle + (ornamentalNoise(seed) - .5) * 1.5;
  const reach = .30 + ornamentalNoise(seed + 1) * .20;
  const end: Point3 = [origin[0] + Math.cos(yaw) * reach,
    origin[1] + .13 + ornamentalNoise(seed + 2) * .23, origin[2] + Math.sin(yaw) * reach];
  const middle = ornamentalPointBetween(origin, end, .42);
  middle[1] += .035;
  const upper = ornamentalPointBetween(middle, end, .55);
  const limb = addOrnamentalLimb(graph, parent, [origin, middle, upper, end], .0032, .0008, "twig");
  const nodes = detailed ? [1, 2, 3] : [1, 3];
  for (const node of nodes) for (const side of [-1, 1]) {
    const leafSeed = seed + node * 17 + side * 3;
    graph.leaves.push({
      length: .18 + ornamentalNoise(leafSeed + 4) * .065,
      pitch: -.85 + ornamentalNoise(leafSeed + 5) * 1.70,
      position: ornamentalAnchor(graph, limb, node),
      roll: side * (.15 + ornamentalNoise(leafSeed + 6) * .85),
      seed: leafSeed,
      width: .16 + ornamentalNoise(leafSeed + 7) * .060,
      yaw: Math.PI / 2 - yaw + side * (1.03 + ornamentalNoise(leafSeed + 8) * .34)
    });
  }
};

const addSecondaryBranches = (graph: OrnamentalTreeGraph, parent: number,
  angle: number, primary: number, detailed: boolean) => {
  const count = detailed ? 6 : 5;
  for (let secondary = 0; secondary < count; secondary++) {
    const seed = graph.variant * 10000 + primary * 193 + secondary * 37;
    const origin = ornamentalAnchor(graph, parent, secondary % 2 + 1);
    const yaw = angle + (secondary % 2 ? -1 : 1) * (.54 + ornamentalNoise(seed) * .53);
    const reach = .48 + ornamentalNoise(seed + 1) * .55;
    const end: Point3 = [origin[0] + Math.cos(yaw) * reach,
      origin[1] + .20 + ornamentalNoise(seed + 2) * .69, origin[2] + Math.sin(yaw) * reach];
    const middle = ornamentalPointBetween(origin, end, .53);
    middle[1] -= .055;
    const limb = addOrnamentalLimb(graph, parent, [origin, middle, end], .0135, .0036, "branch");
    const shoots = detailed ? 4 : 3;
    for (let shoot = 0; shoot < shoots; shoot++)
      leafShoot(graph, limb, shoot % 2 + 1, yaw + shoot * .71, seed + shoot * 59, detailed);
  }
};

const addLeaderCrown = (graph: OrnamentalTreeGraph, height: number, lean: number, detailed: boolean) => {
  for (let leader = 0; leader < 3; leader++) {
    const angle = leader * 2.18 + graph.variant * .57;
    const start = ornamentalAnchor(graph, 0, leader === 0 ? 2 : 3);
    const reach = [.94, 1.24, .83][graph.variant]!;
    const end = point(angle + .25, reach,
      height * (.80 + leader * .055), lean);
    const elbow = ornamentalPointBetween(start, end, .34);
    elbow[0] += Math.cos(angle) * .13;
    const shoulder = ornamentalPointBetween(elbow, end, .59);
    shoulder[2] += Math.sin(angle + .4) * .12;
    const parent = addOrnamentalLimb(graph, 0, [start, elbow, shoulder, end], .13, .024, "branch");
    for (let branch = 0; branch < 4; branch++) {
      const seed = graph.variant * 1000 + leader * 239 + branch * 71;
      const originIndex = branch % 2 + 1;
      const origin = ornamentalAnchor(graph, parent, originIndex);
      const yaw = angle + branch * GOLDEN_ANGLE + ornamentalNoise(seed) * .35;
      const spread = [1.46, 1.78, 1.24][graph.variant]!;
      const reach = spread * (.74 + ornamentalNoise(seed + 1) * .38);
      const end: Point3 = [origin[0] + Math.cos(yaw) * reach,
        origin[1] + .46 + ornamentalNoise(seed + 2) * .65, origin[2] + Math.sin(yaw) * reach];
      const elbow = ornamentalPointBetween(origin, end, .40);
      elbow[1] -= .09;
      const shoulder = ornamentalPointBetween(elbow, end, .57);
      shoulder[1] += .075;
      const radius = originIndex === 1 ? .055 : .032;
      const limb = addOrnamentalLimb(graph, parent, [origin, elbow, shoulder, end], radius, .010, "branch");
      addSecondaryBranches(graph, limb, yaw, leader * 4 + branch, detailed);
    }
    for (let shoot = 0; shoot < (detailed ? 4 : 3); shoot++)
      leafShoot(graph, parent, 3, angle + shoot * 1.38, 9000 + leader * 173 + shoot * 31, detailed);
  }
  for (let shoot = 0; shoot < 2; shoot++)
    leafShoot(graph, 0, 5, shoot * 2.6 + graph.variant, 12000 + shoot * 137, detailed);
};

/** Three co-dominant leaders carry a rounded crown, rather than regular conifer-like branch tiers. */
export const createMapleTreeGraph = (variant = 0, detailed = true): OrnamentalTreeGraph => {
  if (!Number.isInteger(variant) || variant < 0 || variant >= MAPLE_TREE_FORMS.length)
    throw new Error("Unknown ornamental maple tree form");
  const height = [5.8, 5.2, 6.4][variant]!;
  const lean = [0, .37, -.12][variant]!;
  const graph: OrnamentalTreeGraph = { blossoms: [], leaves: [], limbs: [], needles: [],
    species: "maple-tree", variant };
  const trunk: Point3[] = [[0, -.14, 0], [.015, .16, -.015], [-.055, 1.32, .035],
    [lean * .38 + .055, height * .34, -.085], [lean * .68 - .045, height * .54, .045],
    [lean + .08, height * .70, -.035]];
  addOrnamentalLimb(graph, null, trunk, .285 + variant * .017, .027, "trunk");
  addRoots(graph);
  addLeaderCrown(graph, height, lean, detailed);
  return graph;
};

