import type { Point3 } from "../buildings/building-recipe";
import {
  addOrnamentalLimb, ornamentalAnchor, ornamentalNoise, ornamentalPointBetween,
  type OrnamentalTreeGraph
} from "./ornamental-tree-graph";

const trunks: Point3[][] = [
  [[0, -.055, 0], [.10, .45, -.04], [-.06, .96, .07], [.16, 1.48, -.08],
    [.04, 2.04, .03], [.20, 2.52, -.05], [.12, 2.90, -.02]],
  [[0, -.055, 0], [-.08, .42, .06], [.09, .86, -.05], [.015, 1.34, .065],
    [-.08, 1.80, -.025], [.02, 2.16, .015], [-.04, 2.48, 0]],
  [[-.17, -.055, 0], [-.11, .47, .065], [.12, 1.0, -.06], [.32, 1.48, .03],
    [.27, 2.0, -.02], [.53, 2.45, .04], [.68, 2.85, 0]]
];
// Eight connected boughs overlap into four substantial, asymmetric crown masses.
// Their depth remains volumetric; the same natural-size flowers cover a smaller projected area.
const crownVolumes: Point3[][] = [
  [[-1.48, 3.85, .28], [-1.10, 4.18, -.38], [.10, 5.00, -.12], [1.28, 4.34, .20],
    [1.46, 3.95, .62], [-.50, 4.48, .52], [.65, 4.65, -.45], [-1.28, 3.95, -.42]],
  [[-1.85, 3.72, .28], [-1.40, 4.12, -.28], [-.48, 4.78, -.16], [.90, 4.18, -.12],
    [1.40, 3.78, .48], [-.90, 4.42, .48], [.40, 4.45, -.42], [-1.65, 3.85, -.36]],
  [[-1.02, 3.91, .24], [-.65, 4.25, -.38], [.52, 5.00, -.10], [1.65, 4.52, .20],
    [1.80, 4.03, .48], [.28, 4.62, .50], [1.05, 4.78, -.42], [-.90, 4.02, -.40]]
];

export interface PeachCrownGroup {
  limbStart: number;
  limbEnd: number;
  flowerStart: number;
  flowerEnd: number;
  leafStart: number;
  leafEnd: number;
}

export type PeachTreeGraph = OrnamentalTreeGraph & {
  crownGroups: PeachCrownGroup[];
  flowerBearings: number[];
  leafBearings: number[];
};

/** Adult upright, low spreading and gently leaning structures; flower/leaf sizes are not tree-scaled. */
export const createFloweringPeachGraph = (variant = 0, detailed = true): PeachTreeGraph => {
  if (![0, 1, 2].includes(variant)) throw new Error("Unknown flowering peach structure");
  const graph: PeachTreeGraph = { species: "flowering-peach", variant,
    limbs: [], needles: [], leaves: [], blossoms: [], crownGroups: [], flowerBearings: [], leafBearings: [] };
  const shift = variant === 2 ? .25 : 0;
  const leaderPath = [...trunks[variant]!, [.10 + shift, 3.20, -.04], [.02 + shift, 3.55, .02],
    [.15 + shift, 3.95, -.10], [.10 + shift, 4.40, -.08], [.12 + shift, 4.80, -.08]] as Point3[];
  // One continuous tapered leader removes the exposed cap where a separate upper trunk met the stem.
  const trunk = addOrnamentalLimb(graph, null, leaderPath, [.29, .27, .31][variant]!, .014, "trunk");
  for (let root = 0; root < 9; root++) {
    const angle = root * 2.399963 + variant * .7, start = ornamentalAnchor(graph, trunk, 0);
    const reach = .58 + ornamentalNoise(root + variant * 17) * .20;
    addOrnamentalLimb(graph, trunk, [start,
      [start[0] + Math.cos(angle) * .26, .055, start[2] + Math.sin(angle) * .23],
      [start[0] + Math.cos(angle) * reach, -.025, start[2] + Math.sin(angle) * reach * .84]],
    .105 - root % 3 * .009, .012, "root");
  }
  const spread = variant === 1 ? 1.10 : 1;
  const leftStart = ornamentalAnchor(graph, trunk, 3);
  const left = addOrnamentalLimb(graph, trunk, [leftStart,
    [leftStart[0] - .34, leftStart[1] + .18, .01],
    [-.92 * spread + shift, 2.50, -.03], [-1.24 * spread + shift, 3.10, -.12]], .145, .060, "branch");
  const rightStart = ornamentalAnchor(graph, trunk, 4);
  const right = addOrnamentalLimb(graph, trunk, [rightStart,
    [rightStart[0] + .42, rightStart[1] + .12, .15],
    [.95 * spread + shift, 2.65, .20], [1.24 * spread + shift, 3.10, .30]], .140, .060, "branch");
  const top = trunk;
  const parents = [left, left, top, right, right, top, right, left];
  for (let arm = 0; arm < 8; arm++) {
    const group: PeachCrownGroup = { limbStart: graph.limbs.length, limbEnd: 0,
      flowerStart: graph.blossoms.length, flowerEnd: 0, leafStart: graph.leaves.length, leafEnd: 0 };
    const parent = parents[arm]!;
    const start = ornamentalAnchor(graph, parent, parent === trunk ? 8 + arm % 2 : 2 + arm % 2);
    const end: Point3 = [...crownVolumes[variant]![arm]!] as Point3;
    const seed = variant * 1000 + arm * 101, angle = Math.atan2(end[2] - start[2], end[0] - start[0]);
    const elbow = ornamentalPointBetween(start, end, .70);
    elbow[0] += Math.sin(angle) * .14; elbow[1] = start[1] + (end[1] - start[1]) * .22;
    elbow[2] -= Math.cos(angle) * .14;
    const shoulder = ornamentalPointBetween(start, end, .93);
    shoulder[0] -= Math.sin(angle) * .09; shoulder[1] = start[1] + (end[1] - start[1]) * .70;
    const thickness = [.060, .050, .046, .058, .047, .048, .052, .047][arm]!;
    const scaffold = addOrnamentalLimb(graph, parent, [start, elbow, shoulder, end], thickness, .014, "branch");
    const branches = detailed ? 8 : 5;
    for (let branch = 0; branch < branches; branch++) {
      const branchSeed = seed + branch * 47, yaw = branch * 2.399963 + angle;
      const latitude = 1 - 2 * (branch + .5) / branches;
      const radial = Math.sqrt(1 - latitude * latitude);
      const origin = ornamentalAnchor(graph, scaffold, 1 + branch % 3);
      const tip: Point3 = [end[0] + Math.cos(yaw) * radial * .40,
        end[1] + latitude * .31, end[2] + Math.sin(yaw) * radial * .37];
      const middle = ornamentalPointBetween(origin, tip, .56); middle[1] += .055;
      const secondary = addOrnamentalLimb(graph, scaffold, [origin, middle, tip], .013, .0055, "branch");
      addAdultShoots(graph, secondary, yaw, branchSeed, detailed);
    }
    group.limbEnd = graph.limbs.length; group.flowerEnd = graph.blossoms.length;
    group.leafEnd = graph.leaves.length; graph.crownGroups.push(group);
  }
  return graph;
};

const addAdultShoots = (graph: PeachTreeGraph, parent: number, yaw: number, seed: number,
  detailed: boolean) => {
  const shoots = detailed ? 6 : 4;
  for (let shoot = 0; shoot < shoots; shoot++) {
    const shootSeed = seed + shoot * 71, angle = yaw + shoot * 2.399963;
    const start = ornamentalAnchor(graph, parent, 1 + shoot % 2);
    const reach = .15 + ornamentalNoise(shootSeed + 1) * .12;
    const end: Point3 = [start[0] + Math.cos(angle) * reach,
      start[1] + (ornamentalNoise(shootSeed + 2) - .32) * .30,
      start[2] + Math.sin(angle) * reach];
    const middle = ornamentalPointBetween(start, end, .34); middle[1] += .018;
    const mother = addOrnamentalLimb(graph, parent, [start, middle, end], .0052, .0027, "twig");
    const laterals = detailed ? 3 : 2;
    for (let lateral = 0; lateral < laterals; lateral++) {
      const origin = ornamentalAnchor(graph, mother, 1 + lateral % 2);
      const lateralSeed = shootSeed + lateral * 193;
      const lateralAngle = angle + [-1.15, 1.05, 2.60][lateral]! +
        (ornamentalNoise(lateralSeed) - .5) * .5;
      const length = .16 + ornamentalNoise(lateralSeed + 1) * .10;
      const terminal: Point3 = [origin[0] + Math.cos(lateralAngle) * length,
        origin[1] + (ornamentalNoise(lateralSeed + 2) - .42) * .28,
        origin[2] + Math.sin(lateralAngle) * length];
      const bend = ornamentalPointBetween(origin, terminal, .44); bend[1] += .018;
      const bearing = addOrnamentalLimb(graph, mother, [origin, bend, terminal], .0025, .0007, "twig");
      const nodes = detailed ? [2, 2, 3][lateral]! : [2, 3][lateral]!;
      addPeachFlowerPairs(graph, bend, terminal, lateralSeed, nodes, bearing);
      // Peach in full flower has sparse emerging leaves; retain readable natural-size individual lamina.
      if (lateral !== 1) continue;
      graph.leafBearings.push(bearing);
      graph.leaves.push({ position: ornamentalPointBetween(bend, terminal, .64),
        yaw: lateralAngle + lateral * .7, pitch: -.55 + ornamentalNoise(lateralSeed + 8) * 1.2,
        roll: (ornamentalNoise(lateralSeed + 9) - .5) * .5,
        length: .14 + ornamentalNoise(lateralSeed + 10) * .045, width: .036, seed: lateralSeed });
    }
  }
};

const addPeachFlowerPairs = (graph: PeachTreeGraph, start: Point3, end: Point3,
  seed: number, nodes: number, bearing: number) => {
  for (let node = 0; node < nodes; node++) {
    const position = ornamentalPointBetween(start, end, .10 + node / (nodes - 1) * .80);
    const nodeSeed = seed + node * 17;
    const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2];
    const horizontal = Math.hypot(dx, dz), length = Math.hypot(horizontal, dy);
    const around = node * 2.399963 + ornamentalNoise(seed + 3) * Math.PI * 2;
    const radial = Math.cos(around), up = Math.sin(around);
    // Buds grow radially from the twig; the actual woody axis must not pierce a flower throat.
    const nx = -dz / horizontal * radial - dx * dy / (horizontal * length) * up;
    const ny = horizontal / length * up;
    const nz = dx / horizontal * radial - dz * dy / (horizontal * length) * up;
    const pitch = Math.acos(Math.min(1, Math.max(-1, ny)));
    const nodeYaw = Math.atan2(nx, nz);
    for (const pair of [0, 1]) {
      graph.flowerBearings.push(bearing);
      graph.blossoms.push({ position: [...position], yaw: nodeYaw,
        pitch: pitch + pair * Math.PI, radius: .024 + ornamentalNoise(nodeSeed + pair * 5) * .006,
        seed: nodeSeed + pair * 3 });
    }
  }
};
