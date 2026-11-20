import { CatmullRomCurve3, Euler, Vector3 } from "three";

import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import type { Point3 } from "../buildings/building-recipe";
import { catalogWillowColumnarVolumes } from "./catalog-willow-columnar-clearance";
import { type OrnamentalLimb, ornamentalNoise } from "./ornamental-tree-graph";
import type { GardenTreeLeaf } from "./roman-garden-tree-graph";

export type CatalogColumnarSpecies = "columnar-cypress" | "italian-poplar" | "juniper-spire";
export interface CatalogConiferSpray { path: Point3[]; width: number }
export interface CatalogColumnarGraph {
  limbs: OrnamentalLimb[]; leaves: GardenTreeLeaf[]; soilHeight: number; sprays: CatalogConiferSpray[]
}

const append = (graph: CatalogColumnarGraph, path: Point3[], radius: number, tipRadius: number,
  parent: number | null, role: OrnamentalLimb["role"]) => {
  graph.limbs.push({ path, radius, tipRadius, parent, role });
  return graph.limbs.length - 1;
};

const addLeaf = (graph: CatalogColumnarGraph, limb: number, parameter: number, yaw: number,
  seed: number, species: CatalogColumnarSpecies, far: boolean) => {
  const poplar = species === "italian-poplar";
  const node = new CatmullRomCurve3(graph.limbs[limb]!.path.map(point => new Vector3(...point)))
    .getPoint(parameter);
  const pitch = poplar ? -.35 + ornamentalNoise(seed) * .85 : -.95 + ornamentalNoise(seed) * .48;
  const roll = (ornamentalNoise(seed + 1) - .5) * 1.3;
  const petioleLength = poplar ? .021 : .004;
  const direction = new Vector3(0, 0, petioleLength).applyEuler(new Euler(pitch, yaw, roll, "YXZ"));
  graph.leaves.push({ position: node.clone().add(direction).toArray() as Point3,
    petiole: { limb, node: node.toArray() as Point3, parameter, radius: poplar ? .0032 : .0016 },
    length: ({ "italian-poplar": .17, "juniper-spire": .083, "columnar-cypress": .065 }[species]) * (.85 + ornamentalNoise(seed + 2) * .30),
    width: ({ "italian-poplar": .12, "juniper-spire": .011, "columnar-cypress": .023 }[species]) * (far ? 1.7 : 1), pitch, roll, seed, yaw });
};

/** Lombardy poplar bears ascending limbs and broad blades; the two conifers bear small radial sprays. */
export const createCatalogColumnarGraph = (species: CatalogColumnarSpecies, variant: number,
  potted: boolean, detailed: boolean, far = false): CatalogColumnarGraph => {
  const soilHeight = potted ? .276 : 0;
  const graph: CatalogColumnarGraph = { limbs: [], leaves: [], soilHeight, sprays: [] };
  const poplar = species === "italian-poplar", juniper = species === "juniper-spire";
  const height = { "columnar-cypress": 2.55, "italian-poplar": 2.75, "juniper-spire": 1.85 }[species];
  const lean = [.012, -.028, .025][variant]!;
  const trunk: Point3[] = [[0, soilHeight - .035, 0], [.01, soilHeight + .10, 0],
    [-.012, soilHeight + height * .37, .008], [lean, soilHeight + height * .73, -.015],
    [lean * .8, soilHeight + height, 0]];
  append(graph, trunk, poplar ? .071 : .059, .006, null, "trunk");
  for (let root = 0; root < 5; root++) {
    const angle = root * 2.399 + variant;
    const reach = (potted ? .105 : .16) * (.75 + ornamentalNoise(root + 8) * .32);
    append(graph, [trunk[1]!, [Math.cos(angle) * reach * .6, soilHeight + .015,
      Math.sin(angle) * reach * .6], [Math.cos(angle) * reach, soilHeight - .02, Math.sin(angle) * reach]],
    .030 * (.75 + ornamentalNoise(root + 9) * .3), .005, 0, "root");
  }
  const leader = new CatmullRomCurve3(trunk.map(point => new Vector3(...point)));
  let nearBranches = detailed ? 42 : 27;
  if (!detailed && !poplar) nearBranches = 26;
  const branches = far ? 16 : nearBranches;
  for (let branch = 0; branch < branches; branch++) {
    const seed = branch * 137 + variant * 997;
    const t = .095 + branch / branches * .86;
    const start = leader.getPoint(t).toArray() as Point3;
    const angle = branch * 2.399 + variant * .8;
    const profile = Math.sin(Math.PI * Math.min(.97, t * .88 + .10)) ** .65;
    const radius = (juniper ? .155 : .145) * profile;
    const lift = (poplar ? .36 : .17) * (1 - t * .45);
    const end: Point3 = [start[0] + Math.cos(angle) * radius, start[1] + lift,
      start[2] + Math.sin(angle) * radius];
    const elbow: Point3 = [(start[0] + end[0]) * .5, start[1] + lift * .25,
      (start[2] + end[2]) * .5];
    const id = append(graph, [start, elbow, end], .015 * (1 - t * .45), .0035, 0, "branch");
    const nearShoots = detailed ? 4 : 3;
    const shoots = far ? 2 : nearShoots;
    const branchCurve = new CatmullRomCurve3([start, elbow, end].map(point => new Vector3(...point)));
    for (let shoot = 0; shoot < shoots; shoot++) {
      const origin = branchCurve.getPoint(.30 + shoot / shoots * .67).toArray() as Point3;
      const yaw = angle + (shoot % 2 ? -.65 : .65);
      const spread = poplar ? .035 : .042;
      const tip: Point3 = [origin[0] + Math.cos(yaw) * spread,
        origin[1] + (poplar ? .11 : .15) * (1 - t * .4), origin[2] + Math.sin(yaw) * spread];
      const twig = append(graph, [origin, tip], .0052, .0021, id, "twig");
      const broadLeaves = detailed ? 4 : 3;
      let needleLeaves = detailed ? 8 : 3;
      if (species === "columnar-cypress") needleLeaves = 3;
      const nearLeaves = poplar ? broadLeaves : needleLeaves;
      const leaves = far ? 3 : nearLeaves;
      for (let leaf = 0; leaf < leaves; leaf++) addLeaf(graph, twig,
        .035 + leaf / leaves * .94, yaw + leaf * (juniper ? 2.399 : 2.12),
        seed + shoot * 29 + leaf * 17, species, far);
      if (!poplar) {
        const heading = yaw + .35;
        const length = (juniper ? .20 : .27) * (.90 + ornamentalNoise(seed) * .16);
        const upper = Math.min(length, soilHeight + height + .025 - origin[1]);
        graph.sprays.push({ path: [origin,
          [origin[0] + Math.cos(heading) * .025, origin[1] + upper * .52,
            origin[2] + Math.sin(heading) * .025],
          [tip[0] + Math.cos(heading) * .035, origin[1] + upper, tip[2] + Math.sin(heading) * .035]],
        width: (juniper ? .037 : .048) * (detailed ? 1 : 1.35) });
      }
    }
  }
  return graph;
};

export const catalogColumnarClearance = (asset: PlantDecorationAsset) => {
  const graph = (detailed: boolean, far: boolean) => createCatalogColumnarGraph(
    asset.species as CatalogColumnarSpecies, asset.variant, asset.potted, detailed, far);
  return catalogWillowColumnarVolumes([graph(true, false), graph(false, false), graph(false, true)], asset.potted);
};
