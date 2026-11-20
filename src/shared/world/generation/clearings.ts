import { countSettlementLand, createBuildCap, createBuildClass } from "../build-class";
import type { FootprintKind } from "../building-footprints";
import { type BuildSite,packAround } from "../building-space";
import { getVertexCount, type GridSize,readVertex } from "../grid-geometry";
import { createFbm, smoothstep } from "../noise";
import { createRandom, deriveSeed } from "../rng";
import { BUILD, type PropSet } from "../world-data";
import { createCellTerrain } from "./gameplay";
import { samplePoissonDisc } from "./poisson-disc";
import { createRoughGround } from "./rough-ground";
import { getStarterPackingFootprints } from "./starter-packing-footprints";

/** Settlement clearing: fully free inside `radius`, a feathered meadow edge outside. */
export interface Clearing {
  radius: number;
  x: number;
  z: number;
}

export interface ClearingTerrain {
  /** Forest mask of the biome (per vertex 0..1): where trees will stand. */
  forest: Float32Array;
  heights: Float32Array;
  /** Mine zone per cell: mine cells are not settlement land. */
  mineZone: Uint16Array;
  /** Distance to the river bed per vertex (rough ground, house clearance). */
  riverDistance: Float32Array;
  waterDepth: Float32Array;
}

/** Bare terrain and the open land left once the forest stands on it. */
interface PlanningSites {
  open: BuildSite;
  terrain: BuildSite;
}

/**
 * Bounded starter-clearing estimate: current HQ and eight representative small residences,
 * using canonical plots/access below. This is not a guarantee of eight actual placeable plots;
 * planned islands separately validate their four reserved5x5 plots and real HQ/harbour.
 */
export const START_AREA = {
  maxRadius: 12,
  minRadius: 6,
  plan: ["large", ...Array<FootprintKind>(8).fill("standard")] as readonly FootprintKind[]
} as const;
/** Further clearings: up to ten standard buildings within the packing radius. */
const CLEARING_PLAN: readonly FootprintKind[] = Array<FootprintKind>(10).fill("standard");
const CLEARING_RADIUS = 4;
/** Buildings a clearing must add over the open land to be worth cutting. */
const MIN_CLEARING_GAIN = 3;
/**
 * From a packing radius to the clear radius: the far corner of the foundation plus its access
 * strip, seen from the foundation centre (large 3.54, standard 2.83 cells).
 */
const CLEAR_PAD = { large: 3.6, standard: 2.9 } as const;
const CLEARING_CLEAR_RADIUS = CLEARING_RADIUS + CLEAR_PAD.standard;
/** Candidate centres are sampled densely; chosen clearings keep this distance between them. */
const CANDIDATE_SPACING = 6;
const CLEARING_SPACING = 2 * CLEARING_CLEAR_RADIUS;
/** The meadow edge: trees come back over 1.5 .. 5.5 cells beyond the clear radius. */
const FEATHER = { min: 1.5, range: 4 } as const;
/** Forest mask above which a cell counts as wooded (trees will block it). */
const FOREST_FREE = 0.02;
/**
 * Share of the shortfall the counted gains must cover: a cut clearing frees more than it counts
 * (its feathered edge, the bushes and stones it clears), so counting the full shortfall cut
 * about twice the forest needed. Should it fall short, the next pass covers the rest.
 */
const SHORTFALL_COVER = 0.6;

const EMPTY_PROPS: PropSet = {
  count: 0,
  form: new Uint8Array(0),
  phase: new Float32Array(0),
  rotation: new Float32Array(0),
  scale: new Float32Array(0),
  types: new Uint8Array(0),
  x: new Float32Array(0),
  y: new Float32Array(0),
  z: new Float32Array(0)
};

/** Build classes of the bare terrain (no vegetation yet) and its settlement land in cells. */
const createTerrainSite = (grid: GridSize, terrain: ClearingTerrain) => {
  const { blocking, slopeClass } = createCellTerrain(grid, { ...terrain, props: EMPTY_PROPS });
  const { heights, mineZone, riverDistance } = terrain;
  const rough = createRoughGround(grid, { heights, riverDistance });
  const buildCap = createBuildCap(grid, { ...rough, mineZone, slopeClass });
  const site: BuildSite = {
    ...grid,
    buildClass: createBuildClass({ ...grid, blocking, buildCap, slopeClass }),
    heights
  };
  const landCells = countSettlementLand({ blocking, buildCap });
  return { landCells, site };
};

const isForestCell = (grid: GridSize, forest: Float32Array, cellX: number, cellZ: number) =>
  readVertex(grid, forest, cellX, cellZ) > FOREST_FREE ||
  readVertex(grid, forest, cellX + 1, cellZ) > FOREST_FREE ||
  readVertex(grid, forest, cellX, cellZ + 1) > FOREST_FREE ||
  readVertex(grid, forest, cellX + 1, cellZ + 1) > FOREST_FREE;

/** The bare terrain with the forest standing on it: the open land the island has anyway. */
const createOpenLandSite = (site: BuildSite, forest: Float32Array): BuildSite => {
  const buildClass = Uint8Array.from(site.buildClass, (value, index) => {
    const cellX = index % site.cellsX;
    const cellZ = Math.floor(index / site.cellsX);
    return isForestCell(site, forest, cellX, cellZ) ? BUILD.none : value;
  });
  return { ...site, buildClass };
};

/** Smallest start radius that fits the start plan (the largest one when none does). */
const chooseStartClearing = (site: BuildSite, start: { x: number; z: number }): Clearing => {
  const { maxRadius, plan } = START_AREA;
  const footprints = getStarterPackingFootprints();
  let radius: number = START_AREA.minRadius;
  while (radius < maxRadius && packAround(site, start, radius, plan, footprints) < plan.length) {
    radius += 1;
  }
  return { radius: radius + CLEAR_PAD.large, x: start.x, z: start.z };
};

/**
 * Dense Poisson spread candidates away from the start, scored by the buildings the clearing adds
 * over the open land (cutting into the forest where flat land hides under it), best first.
 */
const scoreCandidates = (sites: PlanningSites, seed: number, start: Clearing) => {
  const random = createRandom(deriveSeed(seed, "clearings"));
  const { cellsX, cellsZ } = sites.terrain;
  const points = samplePoissonDisc(cellsX, cellsZ, CANDIDATE_SPACING, random);
  const candidates: { gain: number; x: number; z: number }[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const centre = { x: points[index]!, z: points[index + 1]! };
    const startGap = Math.hypot(centre.x - start.x, centre.z - start.z) - start.radius;
    if (startGap < CLEARING_CLEAR_RADIUS) continue;
    const gain =
      packAround(sites.terrain, centre, CLEARING_RADIUS, CLEARING_PLAN) -
      packAround(sites.open, centre, CLEARING_RADIUS, CLEARING_PLAN);
    if (gain >= MIN_CLEARING_GAIN) candidates.push({ gain, ...centre });
  }
  return candidates.sort((a, b) => b.gain - a.gain);
};

const isFarFromClearings = (clearings: Clearing[], x: number, z: number) =>
  clearings.every((clearing) => Math.hypot(clearing.x - x, clearing.z - z) >= CLEARING_SPACING);

/**
 * Spaced clearings, best first: Poisson spacing alone would leave too few good spots, so the
 * dense candidates are thinned here.
 */
const rankFurtherClearings = (sites: PlanningSites, seed: number, start: Clearing) => {
  const ranked: (Clearing & { gain: number })[] = [];
  for (const { gain, x, z } of scoreCandidates(sites, seed, start)) {
    if (!isFarFromClearings(ranked, x, z)) continue;
    ranked.push({ gain, radius: CLEARING_CLEAR_RADIUS, x, z });
  }
  return ranked;
};

/**
 * Clearings that cover a shortfall of standard plots, scored against the grown island (its real
 * trees, bushes and stones): the best real gains first, until the shortfall is covered
 * (SHORTFALL_COVER). Planning against the result keeps every tree the minimums do not need: a
 * dense ("Many") forest gets a few compact clearings, not a clearing on every candidate.
 */
export const pickClearings = (
  terrain: BuildSite,
  grown: BuildSite,
  candidates: readonly Clearing[],
  shortfall: number
) => {
  const scored = candidates
    .map((clearing) => ({
      clearing,
      gain:
        packAround(terrain, clearing, CLEARING_RADIUS, CLEARING_PLAN) -
        packAround(grown, clearing, CLEARING_RADIUS, CLEARING_PLAN)
    }))
    .filter(({ gain }) => gain >= MIN_CLEARING_GAIN)
    .sort((a, b) => b.gain - a.gain);
  const picked: Clearing[] = [];
  let gained = 0;
  for (const { clearing, gain } of scored) {
    if (gained >= shortfall * SHORTFALL_COVER) break;
    picked.push(clearing);
    gained += gain;
  }
  return picked;
};

/** Paints one clearing into the mask (max blend), its edge moved by the noise. */
const paintClearing = (
  grid: GridSize,
  mask: Float32Array,
  edgeNoise: (x: number, z: number) => number,
  clearing: Clearing
) => {
  const reach = clearing.radius + FEATHER.min + FEATHER.range;
  const minX = Math.max(0, Math.floor(clearing.x - reach));
  const maxX = Math.min(grid.cellsX, Math.ceil(clearing.x + reach));
  const minZ = Math.max(0, Math.floor(clearing.z - reach));
  const maxZ = Math.min(grid.cellsZ, Math.ceil(clearing.z + reach));
  for (let vertexZ = minZ; vertexZ <= maxZ; vertexZ += 1) {
    for (let vertexX = minX; vertexX <= maxX; vertexX += 1) {
      const distance = Math.hypot(vertexX - clearing.x, vertexZ - clearing.z);
      const edge = edgeNoise(vertexX * 0.2, vertexZ * 0.2) * 0.5 + 0.5;
      const feather = FEATHER.min + edge * FEATHER.range;
      const weight = 1 - smoothstep(clearing.radius, clearing.radius + feather, distance);
      const index = vertexZ * (grid.cellsX + 1) + vertexX;
      mask[index] = Math.max(mask[index]!, weight);
    }
  }
};

/** Per vertex clearing weight 0..1: 1 inside, a noise feathered meadow edge outside. */
export const paintClearings = (grid: GridSize, seed: number, clearings: Clearing[]) => {
  const mask = new Float32Array(getVertexCount(grid));
  const edgeNoise = createFbm(deriveSeed(seed, "clearing-edge"), { octaves: 3 });
  for (const clearing of clearings) paintClearing(grid, mask, edgeNoise, clearing);
  return mask;
};

/**
 * Settlement clearings, planned on the bare terrain before any vegetation: the start clearing
 * fits a headquarters and eight buildings; `further` lists the spaced candidates that could cut
 * meadows into the forest on flat land (pickClearings chooses among them once the vegetation
 * shows the real shortfall). `terrain` is the bare island site.
 */
export const planClearings = (
  grid: GridSize,
  seed: number,
  terrain: ClearingTerrain,
  start: { x: number; z: number }
) => {
  const { landCells, site } = createTerrainSite(grid, terrain);
  const sites: PlanningSites = { open: createOpenLandSite(site, terrain.forest), terrain: site };
  const startClearing = chooseStartClearing(site, start);
  const further: Clearing[] = rankFurtherClearings(sites, seed, startClearing);
  return { further, landCells, start: startClearing, terrain: site };
};
