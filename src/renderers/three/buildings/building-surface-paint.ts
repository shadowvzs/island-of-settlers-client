import type { BuildingSurface, NationDecorSurface } from "../../../render-common/buildings/building-recipe";
import type { IndigenousTextileSurface } from "../../../render-common/buildings/indigenous-textile-styles";
import { NATION_ROOF_COLOURS } from "../../../render-common/buildings/nation-roof-colours";
import type { BuildingSurfacePaint } from "../../../render-common/content-builders";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { bambooLeafDetail } from "./bamboo-leaf-detail";
import { paintSurfacePixels } from "./building-surface-pixels";
import { cacaoLeafDetail } from "./cacao-surface-detail";
import { chineseRedBrickDetail } from "./chinese-red-brick-detail";
import { chineseGlazedTileDetail } from "./chinese-roof-detail";
import { nubianAdobeDetail, nubianPressedRoofDetail, persianStuccoDetail, persianVaultDetail }
  from "./cultural-earth-surface-detail";
import {
chineseRenderDetail,   japanesePlankDetail, japaneseRenderDetail, japaneseTimberDetail, vikingStaveDetail
} from "./cultural-timber-surface-detail";
import {
  indigenousLeatherCanvasDetail, indigenousPatchedCanvasDetail
} from "./indigenous-canvas-detail";
import { indigenousRubbleDetail } from "./indigenous-rubble-detail";
import {
  indigenousClothDetail, indigenousCouncilClothDetail, indigenousHideDetail, indigenousWaterClothDetail
} from "./indigenous-surface-detail";
import {
  indigenousHuntingHide, indigenousMountainHide, indigenousReedHide, indigenousSunHide
} from "./indigenous-textile-patterns";
import { japaneseArchitecturalBambooDetail } from "./japanese-bamboo-detail";
import { japaneseCatapultStoneDetail, japaneseCatapultStoneMinimalDetail } from "./japanese-catapult-stone-detail";
import { japaneseWhiteStoneDetail } from "./japanese-white-stone-detail";
import { mayaPalmRoofDetail, mayaReedRoofDetail } from "./maya-plant-roof-detail";
import { mayaLimestoneDetail } from "./maya-stone-detail";
import { mayaThatchDetail } from "./maya-thatch-detail";
import { earthenRoofDetail, kawaraDetail, vikingShingleDetail } from "./nation-roof-surface-detail";
import { palmThatchDetail } from "./palm-thatch-detail";
import { palmTrunkDetail } from "./palm-trunk-detail";
import { reedMatDetail } from "./reed-mat-detail";
import { sampleRomanSurfaceDetail } from "./roman-surface-detail";
import type { SurfaceSampler } from "./surface-detail-common";

/**
 * The building surface recipes as data (no three.js, no DOM): the world workers paint them
 * while the island loads, the page paints them for the tools (showcase, exports).
 */
type Colour = readonly [number, number, number];

/** Nation decor atlases come from the nation's own pack (nation-building-materials.ts). */
export type PaintedSurface = Exclude<BuildingSurface, "roof-shingles" | "roof-slate" | NationDecorSurface | IndigenousTextileSurface>;

export const ROMAN_SURFACE_COLOURS: Record<PaintedSurface, Colour> = {
  "roof-thatch": [152, 126, 76],
  "palm-thatch": [151, 112, 76],
  "palm-trunk": [157, 119, 80],
  "feed-grain": [197, 154, 79],
  "feed-water": [71, 114, 118],
  "tanning-liquid": [112, 71, 29],
  mosaic: [169, 103, 72],
  copper: [185, 103, 60],
  rope: [128, 111, 83],
  paint: [245, 241, 229],
  plaster: [194, 184, 158],
  stone: [165, 151, 130],
  "cut-stone": [174, 166, 147],
  bread: [164, 105, 47],
  wood: [94, 76, 57],
  planks: [98, 79, 59],
  bark: [76, 69, 57],
  endgrain: [146, 123, 87],
  fish: [128, 163, 190],
  sacking: [139, 117, 85],
  straw: [162, 122, 59],
  amber: [196, 137, 64],
  hide: [236, 224, 206],
  roof: NATION_ROOF_COLOURS.roman,
  iron: [65, 69, 65],
  steel: [190, 199, 208],
  cloth: [108, 55, 47],
  "cloth-water": [214, 196, 159],
  "cloth-council": [214, 196, 159],
  leaf: [62, 82, 49],
  dark: [37, 32, 25],
  gold: [214, 168, 70]
};

/** A nation's own procedural surface: its painter, base colour, relief strength and finish. */
export interface NationSurface {
  base: Colour;
  highResolution?: number;
  minimalResolution?: number;
  minimalSample?: SurfaceSampler;
  normalScale: number;
  roughness: number;
  sample: SurfaceSampler;
}

const ARCHITECTURAL_BAMBOO: NationSurface = {
  base: [203, 163, 88], normalScale: .45, roughness: .92, sample: japaneseArchitecturalBambooDetail
};

export const NATION_SURFACES: Partial<Record<WorkerNation, Partial<Record<BuildingSurface, NationSurface>>>> = {
  chinese: {
    "chinese-red-brick": {base:[160,91,72],highResolution:512,minimalResolution:256,normalScale:.7,roughness:.96,sample:chineseRedBrickDetail},
    "japanese-bamboo": ARCHITECTURAL_BAMBOO,
    leaf: { base: [50, 106, 44], normalScale: .42, roughness: .48, sample: cacaoLeafDetail },
    plaster: { base: [239, 217, 182], normalScale: .4, roughness: .94, sample: chineseRenderDetail },
    roof: { base: NATION_ROOF_COLOURS.chinese, normalScale: .08, roughness: .84, sample: chineseGlazedTileDetail }
  },
  persian: {
    leaf: { base: [51, 105, 43], normalScale: .35, roughness: .52, sample: cacaoLeafDetail },
    plaster: { base: [218, 205, 179], normalScale: .75, roughness: .94, sample: persianStuccoDetail },
    roof: { base: NATION_ROOF_COLOURS.persian, normalScale: .55, roughness: .94, sample: persianVaultDetail }
  },
  maya: {
    leaf: { base: [40, 91, 39], normalScale: .5, roughness: .68, sample: cacaoLeafDetail },
    plaster: { base: [232, 213, 172], normalScale: .35, roughness: .97, sample: mayaLimestoneDetail },
    stone: { base: [225, 204, 162], normalScale: .35, roughness: .98, sample: mayaLimestoneDetail },
    "cut-stone": { base: [235, 217, 181], normalScale: .35, roughness: .97,
      sample: mayaLimestoneDetail },
    "palm-thatch": { minimalResolution: 256, base: [255, 255, 255], normalScale: .85,
      roughness: .99, sample: mayaPalmRoofDetail },
    "roof-thatch": { minimalResolution: 256, base: [255, 255, 255], normalScale: .85,
      roughness: .99, sample: mayaReedRoofDetail },
    straw: { minimalResolution: 256, base: [255, 255, 255], normalScale: .8, roughness: .98, sample: mayaThatchDetail },
    roof: { base: NATION_ROOF_COLOURS.maya, normalScale: .7, roughness: .98,
      sample: point => sampleRomanSurfaceDetail("roof-thatch", point, true) }
  },
  indigenous: {
    "indigenous-rubble":{base:[132,130,125],normalScale:.45,roughness:.99,sample:indigenousRubbleDetail},
    "cloth-reeds": { base: [190, 174, 120], normalScale: .55, roughness: .94, sample: reedMatDetail },
    leaf: { base: [52, 105, 45], normalScale: .45, roughness: .62, sample: cacaoLeafDetail },
    "palm-trunk": { base: [157, 119, 80], normalScale: .65, roughness: .94, sample: palmTrunkDetail },
    "palm-thatch": { minimalResolution: 512, base: [255, 255, 255], normalScale: 1.05, roughness: .99, sample: palmThatchDetail },
    "cloth-council": { base: [190, 143, 88], minimalResolution: 512,
      normalScale: .8, roughness: .99, sample: indigenousCouncilClothDetail },
    "cloth-water": { base: [214, 196, 159], normalScale: .8, roughness: .99, sample: indigenousWaterClothDetail },
    cloth: { base: [214, 196, 159], normalScale: .8, roughness: .99, sample: indigenousClothDetail },
    "hide-hunt": { base: [210, 185, 145], normalScale: .55, roughness: .99, sample: indigenousHuntingHide },
    "hide-mountains": { base: [210, 185, 145], normalScale: .55, roughness: .99, sample: indigenousMountainHide },
    "hide-reeds": { base: [210, 185, 145], normalScale: .55, roughness: .99, sample: indigenousReedHide },
    "hide-sun": { base: [210, 185, 145], normalScale: .55, roughness: .99, sample: indigenousSunHide },
    hide: { base: [210, 185, 145], normalScale: .55, roughness: .99, sample: indigenousHideDetail },
    "cloth-patched": {
      base: [219, 205, 176], normalScale: .65, roughness: .99, sample: indigenousPatchedCanvasDetail
    },
    "cloth-hide-trim": {
      base: [222, 208, 179], normalScale: .65, roughness: .99, sample: indigenousLeatherCanvasDetail
    },
    plaster: { base: [143, 119, 80], normalScale: .65, roughness: .98, sample: earthenRoofDetail },
    roof: { base: NATION_ROOF_COLOURS.indigenous, normalScale: .5, roughness: .98, sample: earthenRoofDetail }
  },
  japanese: {
    "japanese-bamboo": ARCHITECTURAL_BAMBOO,
    "japanese-catapult-stone": {base:[232,231,221],highResolution:512,minimalResolution:256,normalScale:.35,roughness:.95,
      sample:japaneseCatapultStoneDetail,minimalSample:japaneseCatapultStoneMinimalDetail},
    "japanese-white-stone": {base:[232,231,221],normalScale:.22,roughness:.95,sample:japaneseWhiteStoneDetail},
    leaf: { base: [91, 151, 52], normalScale: .4, roughness: .78, sample: bambooLeafDetail },
    plaster: { base: [219, 218, 204], normalScale: .35, roughness: .94, sample: japaneseRenderDetail },
    wood: { base: [105, 87, 73], normalScale: .45, roughness: .85, sample: japaneseTimberDetail },
    planks: { base: [109, 90, 73], normalScale: .5, roughness: .88, sample: japanesePlankDetail },
    roof: { base: NATION_ROOF_COLOURS.japanese, normalScale: .8, roughness: .9, sample: kawaraDetail }
  },
  nubian: {
    plaster: { base: [206, 160, 108], normalScale: 1.05, roughness: .99, sample: nubianAdobeDetail },
    roof: { base: NATION_ROOF_COLOURS.nubian, normalScale: .90, roughness: .99, sample: nubianPressedRoofDetail }
  },
  viking: {
    wood: { base: [139, 112, 77], normalScale: .8, roughness: .97, sample: vikingStaveDetail },
    planks: { base: [139, 112, 77], normalScale: .95, roughness: .98, sample: vikingStaveDetail },
    roof: { base: NATION_ROOF_COLOURS.viking, normalScale: 1, roughness: .95, sample: vikingShingleDetail }
  }
};

/** Map size of the building packs: 1024² on High, 128² on Minimal. */
export const buildingSurfaceResolution = (detailed: boolean) => (detailed ? 1024 : 128);

/** Selected fine-fibre atlases retain readable strands on Minimal; every other map keeps the shared size. */
export const nationSurfaceResolution = (nation: WorkerNation, surface: BuildingSurface, detailed: boolean) => {
  if (detailed) return NATION_SURFACES[nation]?.[surface]?.highResolution ?? buildingSurfaceResolution(true);
  return NATION_SURFACES[nation]?.[surface]?.minimalResolution ?? buildingSurfaceResolution(false);
};

/** Map size of the ware pack (carried goods, cart cargo): 256² on High, 64² on Minimal. */
export const wareSurfaceResolution = (detailed: boolean) => (detailed ? 256 : 64);

/** One key per painted map set (the prepainted lookup and the island cache). */
const SURFACE_REVISIONS: Readonly<Record<string, string>> = {
  "japanese planks": "fitted-cedar-boards-v1",
  "indigenous indigenous-rubble": "rough-recessed-grey-binder-v2",
  "chinese-red-brick": "muted-fired-brick-v1",
  "japanese japanese-catapult-stone": "fine-contrasting-joints-v1",
  "chinese leaf": "crop-leaf-v2", "indigenous leaf": "crop-leaf-v2",
  "maya palm-thatch": "palm-fan-v1", "maya roof-thatch": "reed-culm-v1",
  "maya straw": "maize-sheath-v3",
  "maya leaf": "crop-leaf-v2", "persian leaf": "crop-leaf-v2",
  "indigenous cloth-council": "council-art-v3", "persian plaster": "straight-lime-masonry-v3",
  "maya plaster": "fitted-maya-ashlar-v2", "maya stone": "fitted-maya-ashlar-v2",
  "maya cut-stone": "fitted-maya-ashlar-v2"
};

export const surfacePaintKey = ({ detailed, nation, resolution, surface }: BuildingSurfacePaint) => {
  const revision = SURFACE_REVISIONS[`${nation} ${surface}`];
  const key = `${nation} ${surface} ${resolution} ${detailed ? "detailed" : "flat"}`;
  return revision ? `${key} ${revision}` : key;
};

const recipeOf = ({ detailed, nation, surface }: BuildingSurfacePaint) => {
  if (nation === "roman") {
    const romanSurface = surface as PaintedSurface;
    const sample: SurfaceSampler = (point) => sampleRomanSurfaceDetail(romanSurface, point, detailed);
    return { base: ROMAN_SURFACE_COLOURS[romanSurface], sample };
  }
  const design = NATION_SURFACES[nation]?.[surface];
  if (!design) throw new Error(`No ${nation} surface recipe for ${surface}`);
  if (!detailed && design.minimalSample) return {...design, sample:design.minimalSample};
  return design;
};

/** The RGBA maps of one surface (albedo, then normal and roughness when detailed). */
export const paintBuildingSurface = (paint: BuildingSurfacePaint) => {
  const { base, sample } = recipeOf(paint);
  return paintSurfacePixels(sample, base, paint.resolution, paint.detailed);
};

/** The Roman surface pack at one map size. */
const listRomanSurfacePaints = (detailed: boolean, resolution: number) =>
  (Object.keys(ROMAN_SURFACE_COLOURS) as PaintedSurface[]).map((surface) =>
    ({ detailed, nation: "roman", resolution, surface }) satisfies BuildingSurfacePaint);

/** Every map set of the ware pack (the Roman surfaces at the ware map size). */
export const listWareSurfacePaints = (detailed: boolean) =>
  listRomanSurfacePaints(detailed, wareSurfaceResolution(detailed));

/** Every map set a nation's buildings paint: the Roman base pack, then the nation's own. */
export const listBuildingSurfacePaints = (nation: WorkerNation, detailed: boolean) => {
  const resolution = buildingSurfaceResolution(detailed);
  const roman = listRomanSurfacePaints(detailed, resolution);
  const own = nation === "roman" ? [] : Object.keys(NATION_SURFACES[nation] ?? {}) as BuildingSurface[];
  return [...roman, ...own.map((surface) => ({ detailed, nation,
    resolution: nationSurfaceResolution(nation, surface, detailed), surface }) satisfies BuildingSurfacePaint)];
};
