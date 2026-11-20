import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { WisteriaFlowerInstance, WisteriaLeafInstance } from "../wisteria-hero-graph";
import type { OrnamentalLimb } from "./ornamental-tree-graph";

export interface WisteriaTreeGraph {
  species: "wisteria-tree";
  variant: number;
  limbs: OrnamentalLimb[];
  flowers: WisteriaFlowerInstance[];
  leaves: WisteriaLeafInstance[];
  racemeBearings: { limb: number; point: number; origin: Point3; length: number }[];
  sprayBearings: { limb: number; point: number; origin: Point3 }[];
}

const noise = (seed: number) => {
  const value = DMath.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const addLimb = (graph: WisteriaTreeGraph, parent: number | null, path: Point3[],
  radius: number, tipRadius: number, role: OrnamentalLimb["role"]) => {
  graph.limbs.push({ parent, path, radius, tipRadius, role });
  return graph.limbs.length - 1;
};

const addRaceme = (graph: WisteriaTreeGraph, limb: number, point: number, seed: number) => {
  const bearing = graph.limbs[limb]!.path[point]!, id = graph.racemeBearings.length;
  const length = .36 + noise(seed + 13) * .20;
  const origin: Point3 = [bearing[0], bearing[1] - .025, bearing[2]];
  graph.racemeBearings.push({ limb, point, origin, length });
  for (let bloom = 0; bloom < 25; bloom++) {
    const t = bloom / 24, angle = bloom * 2.39996 + noise(seed) * Math.PI * 2;
    const radius = .013 * (1 - t) ** .6 + .003;
    const driftX = DMath.sin(seed) * .035, driftZ = DMath.cos(seed * .7) * .025;
    graph.flowers.push({ cluster: id, clusterOrigin: origin,
      position: [origin[0] + driftX * t + DMath.sin(angle) * radius,
        origin[1] - t * length, origin[2] + driftZ * t + DMath.cos(angle) * radius],
      yaw: angle, scale: .065 * (1 - .36 * t), bud: bloom >= 20,
      tilt: bloom >= 20 ? .1 : .65 + .35 * DMath.sin(bloom * 1.3) ** 2 });
  }
};

const addSpray = (graph: WisteriaTreeGraph, limb: number, point: number, seed: number) => {
  const origin = [...graph.limbs[limb]!.path[point]!] as Point3;
  const id = graph.sprayBearings.length, yaw = seed * 2.39996;
  const forward: Point3 = [DMath.sin(yaw), -.34, DMath.cos(yaw)];
  const across: Point3 = [DMath.cos(yaw), 0, -DMath.sin(yaw)];
  const length = .29 + noise(seed + 4) * .10;
  const at = (t: number): Point3 => [origin[0] + forward[0] * length * t,
    origin[1] + forward[1] * length * t + DMath.sin(Math.PI * t) * .035,
    origin[2] + forward[2] * length * t];
  graph.sprayBearings.push({ limb, point, origin });
  for (let pair = 0; pair < 6; pair++) for (const side of [-1, 1]) {
    const t = .10 + pair * .145, centre = at(t);
    graph.leaves.push({ spray: id, sprayOrigin: origin,
      position: [centre[0] + across[0] * side * .007, centre[1], centre[2] + across[2] * side * .007],
      direction: [across[0] * side + forward[0] * .32, -.20, across[2] * side + forward[2] * .32],
      length: .082 + DMath.sin(t * Math.PI) * .036, shade: .89 + id % 5 * .03,
      roll: ((id + pair) % 2 ? -1 : 1) * (.58 + ((id + pair) % 4) * .16) });
  }
  graph.leaves.push({ spray: id, sprayOrigin: origin, position: at(1),
    direction: [forward[0], -.15, forward[2]], length: .105, shade: .98 });
};

/** A trained self-supporting mature vine, with real branch bearings shared by every render tier. */
export const createWisteriaTreeGraph = (variant = 0): WisteriaTreeGraph => {
  const form = Math.abs(Math.trunc(variant)) % 3;
  const graph: WisteriaTreeGraph = { species: "wisteria-tree", variant: form, limbs: [],
    flowers: [], leaves: [], racemeBearings: [], sprayBearings: [] };
  const height = [2.82, 3.13, 2.66][form]!, lean = [.12, -.16, .23][form]!;
  for (let braid = 0; braid < 3; braid++) {
    const path: Point3[] = [];
    for (let node = 0; node <= 16; node++) {
      const t = node / 16, angle = t * Math.PI * 2.4 + braid * Math.PI * 2 / 3;
      const radius = .075 * (1 - .22 * t);
      path.push([DMath.sin(angle) * radius + lean * t * t, .035 + t * height,
        DMath.cos(angle) * radius + DMath.sin(t * 3) * .045]);
    }
    addLimb(graph, null, path, .105 - braid * .012, .034 - braid * .004, "trunk");
  }
  for (let root = 0; root < 6; root++) {
    const parent = root % 3, start = [...graph.limbs[parent]!.path[1]!] as Point3;
    const angle = root * Math.PI / 3 + .21 + form * .13, reach = .35 + noise(root + 15) * .18;
    addLimb(graph, parent, [start, [DMath.sin(angle) * .20, .085, DMath.cos(angle) * .20],
      [DMath.sin(angle) * reach, .006, DMath.cos(angle) * reach]], .08, .010, "root");
  }
  const angles = [.12, .68, 1.70, 2.19, 3.13, 3.91, 4.70, 5.55];
  for (let branch = 0; branch < 8; branch++) {
    const parent = branch % 3;
    const bearing = branch < 3 ? 16 : 11 + branch % 4;
    const start = [...graph.limbs[parent]!.path[bearing]!] as Point3;
    const angle = angles[branch]! + form * .22, radial = 1.25 + noise(branch + form * 18) * .36;
    const peak = height + .20 + noise(branch * 7 + form) * .47;
    const outward = (distance: number, y: number, turn = 0): Point3 =>
      [lean + DMath.sin(angle + turn) * distance, y, DMath.cos(angle + turn) * distance];
    const primary = addLimb(graph, parent, [start, outward(.38, start[1] + .35, -.10),
      outward(.85, peak, -.06), outward(radial, peak - .12), outward(radial + .06, peak - .22, .07)],
    .052 - branch % 3 * .005, .012, "branch");
    for (let spur = 0; spur < 4; spur++) {
      const origin = [...graph.limbs[primary]!.path[1 + spur % 3]!] as Point3;
      const side = spur % 2 ? 1 : -1, bearing = angle + side * (.55 + spur * .09);
      const length = .38 + noise(branch * 11 + spur + form) * .25;
      const path: Point3[] = [origin];
      for (let node = 1; node <= 4; node++) {
        const t = node / 4;
        path.push([origin[0] + DMath.sin(bearing + t * side * .16) * length * t,
          origin[1] + DMath.sin(t * Math.PI) * .11 - t * (.04 + spur * .015),
          origin[2] + DMath.cos(bearing + t * side * .16) * length * t]);
      }
      const secondary = addLimb(graph, primary, path, .018, .0055, "twig");
      for (let at = 1; at <= 4; at++) addRaceme(graph, secondary, at, branch * 191 + spur * 29 + at + form * 53);
      for (let at = 2; at <= 4; at++) for (let crown = 0; crown < 3; crown++)
        addSpray(graph, secondary, at, branch * 17 + spur * 7 + at + form * 31 + crown * 43);
    }
  }
  // Compact the supported woody bearings, not the flowers or leaflets themselves: a mature
  // flowering standard has overlapping canopy masses rather than isolated radial boughs.
  const compact = (point: readonly [number, number, number]): Point3 => [point[0] * .84, point[1], point[2] * .84];
  for (const limb of graph.limbs) limb.path = limb.path.map(compact);
  for (const bearing of graph.racemeBearings) bearing.origin = compact(bearing.origin);
  for (const bearing of graph.sprayBearings) bearing.origin = compact(bearing.origin);
  graph.flowers = graph.flowers.map(flower => ({ ...flower, position: compact(flower.position),
    clusterOrigin: graph.racemeBearings[flower.cluster!]!.origin }));
  graph.leaves = graph.leaves.map(leaf => ({ ...leaf, position: compact(leaf.position),
    sprayOrigin: graph.sprayBearings[leaf.spray!]!.origin }));
  return graph;
};

/** Conservative whole-model reservation; rendering tiers must never change physical placement. */
export const wisteriaTreeBounds = (variant = 0) => {
  const graph = createWisteriaTreeGraph(variant);
  const min: Point3 = [Infinity, 0, Infinity], max: Point3 = [-Infinity, 0, -Infinity];
  for (const limb of graph.limbs) for (const point of limb.path) for (const axis of [0, 1, 2] as const) {
    min[axis] = Math.min(min[axis], point[axis] - limb.radius * 1.12);
    max[axis] = Math.max(max[axis], point[axis] + limb.radius * 1.12);
  }
  for (const flower of graph.flowers) for (const axis of [0, 1, 2] as const) {
    min[axis] = Math.min(min[axis], flower.position[axis] - .12);
    max[axis] = Math.max(max[axis], flower.position[axis] + .12);
  }
  for (const leaf of graph.leaves) for (const axis of [0, 1, 2] as const) {
    min[axis] = Math.min(min[axis], leaf.position[axis] - leaf.length * 1.3);
    max[axis] = Math.max(max[axis], leaf.position[axis] + leaf.length * 1.3);
  }
  // The original front/side botanical captures include transparent sheet corners outside the
  // exact leaf/floret silhouette. Reserve their union too, so a LOD change cannot enlarge it.
  for (const axis of [0, 1, 2] as const) { min[axis] -= .16; max[axis] += .16; }
  min[1] = 0;
  return { min, max };
};

/** Separate low woody supports from the raised flower/leaf curtain; no solid wall under the crown. */
export const wisteriaTreeClearanceVolumes = (variant = 0) => {
  const graph = createWisteriaTreeGraph(variant), bounds = wisteriaTreeBounds(variant);
  const volumes = graph.limbs.map(limb => {
    const reach = limb.radius * 1.2 + .025;
    const min = [0, 1, 2].map(axis => Math.min(...limb.path.map(point => point[axis]!)) - reach) as Point3;
    const max = [0, 1, 2].map(axis => Math.max(...limb.path.map(point => point[axis]!)) + reach) as Point3;
    min[1] = Math.max(0, min[1]);
    return { min, max };
  });
  const flowerFloor = Math.min(...graph.flowers.map(flower => flower.position[1] - .18));
  const leafFloor = Math.min(...graph.leaves.map(leaf => leaf.position[1] - leaf.length * 1.3));
  volumes.push({ min: [bounds.min[0], Math.max(.20, Math.min(flowerFloor, leafFloor) - .16), bounds.min[2]],
    max: [...bounds.max] as Point3 });
  return volumes;
};
