import { CatmullRomCurve3, Euler, Vector3 } from "three";

import type { PlantDecorationAsset } from "../../../../island-of-settlers-shared/src/road-plant-items";
import type { Point3 } from "../buildings/building-recipe";
import { catalogWillowColumnarVolumes } from "./catalog-willow-columnar-clearance";
import { type OrnamentalLimb, ornamentalNoise } from "./ornamental-tree-graph";
import type { GardenTreeLeaf } from "./roman-garden-tree-graph";

export type CatalogWillowSpecies = "compact-willow" | "silver-willow" | "golden-willow" | "narrow-willow";
export interface CatalogWillowGraph { limbs: OrnamentalLimb[]; leaves: GardenTreeLeaf[] }

const centreline = (path: Point3[]) => new CatmullRomCurve3(path.map(point => new Vector3(...point)));
const appendLimb = (graph: CatalogWillowGraph, parent: number | null, path: Point3[],
  radius: number, tipRadius: number, role: OrnamentalLimb["role"]) => {
  graph.limbs.push({ parent, path, radius, tipRadius, role });
  return graph.limbs.length - 1;
};

const appendLeaf = (graph: CatalogWillowGraph, limb: number, parameter: number, yaw: number,
  seed: number, species: CatalogWillowSpecies, detailed: boolean, far: boolean) => {
  const node = centreline(graph.limbs[limb]!.path).getPoint(parameter);
  const pitch = limb === 0 ? -.45 + ornamentalNoise(seed) * .40 : .26 + ornamentalNoise(seed) * .90;
  const roll = (ornamentalNoise(seed + 3) - .5) * .80;
  const rotation = new Euler(pitch, yaw, roll, "YXZ");
  const position = node.clone().add(new Vector3(0, 0, .027).applyEuler(rotation));
  const widths = { "compact-willow": .067, "silver-willow": .067,
    "golden-willow": .059, "narrow-willow": .043 };
  const lengths = { "compact-willow": .21, "silver-willow": .20,
    "golden-willow": .235, "narrow-willow": .245 };
  const width = widths[species];
  const enlargement = far ? 1.75 : 1;
  graph.leaves.push({ length: lengths[species] + ornamentalNoise(seed + 1) * .045,
    petiole: { limb, node: node.toArray() as Point3, parameter, radius: .0035 },
    pitch, position: position.toArray() as Point3, roll, seed,
    width: width * (detailed ? 1 : 1.22) * enlargement, yaw });
};

/** Raised roadside crowns keep every hanging shoot and leaf above the shared 2.3m passage. */
export const createCatalogWillowGraph = (species: CatalogWillowSpecies, variant: number,
  roadside: boolean, detailed: boolean, far = false): CatalogWillowGraph => {
  const graph: CatalogWillowGraph = { leaves: [], limbs: [] };
  const narrow = species === "narrow-willow";
  const height = { "compact-willow": 3.65, "silver-willow": 3.45,
    "golden-willow": 3.60, "narrow-willow": 3.70 }[species];
  const roadsideSpread = narrow ? .27 : .43;
  const standaloneSpreads = { "compact-willow": 1.09, "silver-willow": 1.09,
    "golden-willow": .98, "narrow-willow": .71 };
  const standaloneSpread = standaloneSpreads[species];
  const spread = roadside ? roadsideSpread : standaloneSpread;
  const crownBase = roadside ? 2.70 : 1.96;
  const lean = [.025, -.055, .060][variant]!;
  const trunk: Point3[] = [[0, -.045, 0], [.012, .14, -.008], [-.02, .76, .012],
    [lean * .55, 1.65, -.014], [lean, crownBase + .16, .015],
    [lean * .8, height - .08, -.025]];
  appendLimb(graph, null, trunk, roadside ? .105 : .155, .006, "trunk");
  for (let root = 0; root < 6; root++) {
    const angle = root * 2.399 + variant * .77;
    const reach = (roadside ? .19 : .35) * (.75 + ornamentalNoise(root + 74) * .38);
    appendLimb(graph, 0, [trunk[1]!, [Math.cos(angle) * reach * .53, .055,
      Math.sin(angle) * reach * .53], [Math.cos(angle) * reach, -.025, Math.sin(angle) * reach]],
    .053 * (.75 + ornamentalNoise(root + 3) * .35), .008, "root");
  }
  const nearBoughs = detailed ? 12 : 9;
  const trunkCurve = centreline(trunk), boughs = far ? 7 : nearBoughs;
  const terminalLeaves = detailed ? 28 : 18;
  for (let leaf = 0; leaf < (far ? 8 : terminalLeaves); leaf++) appendLeaf(graph, 0,
    .88 + leaf / terminalLeaves * .119, leaf * 2.399 + variant,
    8001 + variant * 173 + leaf * 37, species, detailed, far);
  for (let bough = 0; bough < boughs; bough++) {
    const seed = bough * 197 + variant * 1009;
    const divergence = species === "golden-willow" ? 2.17 : 2.399;
    const angle = bough * divergence + variant * .62;
    const fraction = bough / boughs;
    const start = trunkCurve.getPoint(.68 + fraction * .26).toArray() as Point3;
    const reach = spread * (.78 + ornamentalNoise(seed + 1) * .22) * (1 - fraction * .35);
    const rise = species === "silver-willow" ? .82 : 1;
    const end: Point3 = [lean + Math.cos(angle) * reach,
      crownBase + .18 + fraction * (height - crownBase - .29) * rise, Math.sin(angle) * reach];
    const archHeight = narrow ? .24 : .16;
    const path: Point3[] = [start, [(start[0] + end[0]) * .5, end[1] + archHeight,
      (start[2] + end[2]) * .5], end];
    const parent = appendLimb(graph, 0, path, .037 - fraction * .014, .008, "branch");
    const nearCurtains = detailed ? 5 : 4;
    const arch = centreline(path), curtains = far ? 2 : nearCurtains;
    for (let shoot = 0; shoot < curtains; shoot++) {
      const t = .35 + shoot / curtains * .62;
      const origin = arch.getPoint(t).toArray() as Point3;
      const heading = angle + (shoot % 2 ? -.7 : .7);
      const step = (roadside ? .044 : .15) * (.65 + ornamentalNoise(seed + shoot) * .35);
      const hangingBase = species === "golden-willow" ? .80 : .64;
      const drop = roadside ? Math.min(origin[1] - 2.63, .32 + ornamentalNoise(seed + 7) * .32)
        : hangingBase + ornamentalNoise(seed + 7) * .45;
      const shootPath: Point3[] = [origin,
        [origin[0] + Math.cos(heading) * step, origin[1] - drop * .24,
          origin[2] + Math.sin(heading) * step],
        [origin[0] + Math.cos(heading) * step * 1.1, origin[1] - drop * .64,
          origin[2] + Math.sin(heading) * step * 1.1],
        [origin[0] + Math.cos(heading) * step * .80, origin[1] - drop,
          origin[2] + Math.sin(heading) * step * .80]];
      const id = appendLimb(graph, parent, shootPath, .011, .0038, "twig");
      const nearLeaves = detailed ? 12 : 8;
      const leaves = far ? 5 : nearLeaves;
      for (let leaf = 0; leaf < leaves; leaf++) appendLeaf(graph, id,
        .035 + leaf / leaves * .93, heading + (leaf % 2 ? 1.05 : -1.05) + leaf * .17,
        seed + shoot * 71 + leaf * 17, species, detailed, far);
    }
  }
  return graph;
};

export const catalogWillowClearance = (asset: PlantDecorationAsset) => {
  const graph = (detailed: boolean, far: boolean) => createCatalogWillowGraph(
    asset.species as CatalogWillowSpecies, asset.variant, asset.form === "roadside", detailed, far);
  return catalogWillowColumnarVolumes([graph(true, false), graph(false, false), graph(false, true)], false);
};
