import { createFbm, smoothstep } from "../noise";
import { deriveSeed, type Random } from "../rng";
import { PROP } from "../world-data";
import type { ThemeVegetation } from "./island-themes";

export const NONE = -1;

const FULL_TURN = Math.PI * 2;

/** Wind phase and facing of a new prop from its own stream (a fixed facing wins). */
export const drawPropMotion = (random: Random, fixedRotation?: number) => {
  const phase = random() * FULL_TURN;
  const turn = random() * FULL_TURN;
  return { phase, rotation: fixedRotation ?? turn };
};

/** Everything the placement rules know about one spot (all 0..1 unless noted). */
export interface PropSample {
  /** Distance to water (sea or river) in cells. */
  coast: number;
  /** Topographic fields (M02b): positive hollows, exposed crests and sun-facing slopes. */
  curvature: number;
  depth: number;
  exposure: number;
  forest: number;
  /** Forest mask gradient (per cell): the stand thins against it (forest edges). */
  forestSlopeX: number;
  forestSlopeZ: number;
  heatLoad: number;
  height: number;
  moisture: number;
  /** Distance to the mountain rock in cells (large where there is none). */
  mountainDistance: number;
  /** Low frequency noise -1..1: which species dominates a stand. */
  species: number;
  /** Low frequency noise -1..1 of the conifer stands: spruce where high, tall forest pine where low. */
  stand: number;
  /** Medium frequency noise -1..1: clearings inside forests, flower patches in meadows. */
  patches: number;
  plateau: number;
  riverDistance: number;
  rock: number;
  /** Share 0..1 of the ground covered by the sculpted mountain rock skin. */
  rockSkin: number;
  /** Beach sand weight of the ground material. */
  sand: number;
  /** Distance to the sea in cells (rivers do not count). */
  seaDistance: number;
  /** Vertex slope (rise per cell over two cells) and the exact surface slope at the spot. */
  slope: number;
  surfaceSlope: number;
  /** Plant clusters: medium noise -1..1 (patch shape) and fine noise -1..1 (holes inside). */
  cluster: number;
  grain: number;
  /** Medium-low frequency noise -1..1 of the birch groves: small pure stands where high. */
  grove: number;
  /** Distance to the nearest tree trunk in cells (capped). */
  trunkDistance: number;
  /** The island theme's vegetation factors (the same for every spot of a world). */
  vegetation: ThemeVegetation;
}

/** Forest edge: the band where the forest thins out into meadow. */
export const getEdgeFactor = (forest: number) =>
  smoothstep(0.03, 0.2, forest) * (1 - smoothstep(0.3, 0.55, forest));

/** Sand weight from which the ground counts as beach (palms and dune grass only). */
export const SAND_GROUND = 0.35;

/** Surface slope from which the ground is a rock face (render-common/rocks CLIFF_SLOPE). */
const ROCK_FACE_SLOPE = 0.9;
/** Rock skin share from which a trunk or a plant would stand inside the rock surface. */
const ROCK_SKIN_LIMIT = 0.02;

/** Mountain skin: a trunk or a plant there would stand inside the sculpted rock surface. */
export const isUnderRockSkin = (sample: PropSample) => sample.rockSkin > ROCK_SKIN_LIMIT;

/** Mountain skin or a rock face (dressed with rock slabs): no tree or land plant roots there. */
export const isRockCovered = (sample: PropSample) =>
  isUnderRockSkin(sample) || sample.surfaceSlope > ROCK_FACE_SLOPE;

/**
 * Plant patch strength 0..1: vegetation grows in irregular clusters (dense middle, thinning
 * edges) with holes inside, never as an even scatter.
 */
export const getClusterFactor = (sample: PropSample) =>
  smoothstep(-0.15, 0.35, sample.cluster) * (0.3 + 0.7 * smoothstep(-0.35, 0.1, sample.grain));

type Weighted = readonly [kind: number, weight: number];

/** Picks a kind by weight (all weights 0: the last entry). */
export const pickWeighted = (entries: Weighted[], random: Random) => {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [kind, weight] of entries) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return entries[entries.length - 1]![0];
};

/**
 * Forest understory by light: ferns and low broadleaf shrubs in the shade near trunks, woody
 * shrubs between the trees, berry bushes and saplings towards edges and clearings.
 */
const chooseUnderstoryKind = (sample: PropSample, random: Random) => {
  const edge = getEdgeFactor(sample.forest);
  const shade = smoothstep(0.3, 0.8, sample.forest);
  const clearing = smoothstep(0.35, 0.6, sample.patches) * shade;
  const nearTrunk = 1 - smoothstep(0.7, 1.4, sample.trunkDistance);
  return pickWeighted(
    [
      [PROP.fern, (0.3 + nearTrunk * 0.8) * shade * (0.4 + sample.moisture)],
      [PROP.broadleafShrub, 0.35 + nearTrunk * 0.3],
      [PROP.bush, 0.45 + edge * 0.4],
      [PROP.berryBush, 0.06 + edge * 0.45],
      [PROP.sapling, 0.04 + edge * 0.25 + clearing * 0.6]
    ],
    random
  );
};

/** Undergrowth below and around the canopy (spots too close to a trunk are skipped). */
export const chooseUndergrowth = (sample: PropSample, random: Random) => {
  const roll = random();
  if (sample.forest > 0.35 && sample.moisture > 0.35 && roll < 0.05) return PROP.mushrooms;
  const edge = getEdgeFactor(sample.forest);
  const density = (0.06 + sample.forest * 0.2 + edge * 0.22) * (0.2 + getClusterFactor(sample));
  if (roll >= 0.05 + density) return NONE;
  return chooseUnderstoryKind(sample, random);
};

/**
 * Open ground: flower clumps in patches, a few low shrubs and stones. Rock ground and steep
 * slopes stay free: the rock library (render-common/rocks) dresses mountains and cliffs.
 */
export const chooseMeadowProp = (sample: PropSample, random: Random) => {
  const roll = random();
  if (sample.plateau > 0.3) return roll < 0.02 ? PROP.flowers : NONE;
  if (sample.rock > 0.5 || sample.slope > 0.6) return NONE;
  const { flowers, tufts } = sample.vegetation;
  const meadow = smoothstep(0.25, 0.55, sample.patches) * (0.4 + sample.moisture * 0.6);
  const flowerChance = meadow * 0.05 * flowers;
  if (roll < flowerChance) return PROP.flowers;
  if (roll < flowerChance + tufts * getClusterFactor(sample)) return PROP.sedge;
  if (roll > 0.988 - getClusterFactor(sample) * 0.012) return PROP.fieldShrub;
  return roll > 0.978 ? PROP.smallRock : NONE;
};

/**
 * River mouth: near the river bed (cells) and this close to the open sea (cells). Covers the
 * widest estuary funnel (max bed radius 1.75 x (1 + MOUTH_FLARE 0.8) = 3.15) plus a margin.
 */
const MOUTH_RIVER_DISTANCE = 3.5;
const MOUTH_SEA_DISTANCE = 12;

/** The estuary stays open water: no reeds, sedges or dune grass across a river mouth. */
const isRiverMouth = (sample: PropSample) =>
  sample.riverDistance < MOUTH_RIVER_DISTANCE && sample.seaDistance < MOUTH_SEA_DISTANCE;

/**
 * Dune grass zone (GROUND-PALETTE step 5): the sand behind a beach, away from the swash (sea distance in cells), where
 * it blends into the grass (sand weight below `blend`), takes denser tussock clumps, so the grass front frays into
 * dune grass instead of a hard edge. The ground shader paints the matching clumps (ground-climate-glsl.ts).
 */
const DUNE_ZONE = { blend: [0.72, 0.98], extra: 0.14, seaDistance: [1.5, 3.5] } as const;

const getDuneZone = (sample: PropSample) =>
  smoothstep(DUNE_ZONE.seaDistance[0], DUNE_ZONE.seaDistance[1], sample.seaDistance) *
  (1 - smoothstep(DUNE_ZONE.blend[0], DUNE_ZONE.blend[1], sample.sand));

/**
 * Beach and dunes: sparse dune grass (sedge tussocks) in loose clusters, denser in the dune zone behind the beach,
 * nothing else on the sand; arid themes add dry tufts. River mouths stay bare.
 */
export const chooseDuneProp = (sample: PropSample, random: Random) => {
  if (isRiverMouth(sample)) return NONE;
  const cluster = getClusterFactor(sample);
  const chance = 0.015 + cluster * (0.1 + sample.vegetation.tufts) + getDuneZone(sample) * DUNE_ZONE.extra *
    (0.4 + cluster);
  return random() < chance ? PROP.sedge : NONE;
};

/** Water depth up to which reeds and cattails still stand in the shallows. */
export const SHALLOWS_DEPTH = 0.12;
/**
 * Reeds and cattails belong at the waterline, not on dry beach sand. A tiny negative depth keeps
 * the wet rim of the bank usable while M01b's higher moisture no longer turns dunes into wetlands.
 */
const WATER_EDGE_MIN_DEPTH = -0.03;
/** Beach reeds stay within this distance of the waterline; farther dry sand is not a wetland. */
const WATER_EDGE_MAX_BEACH_COAST = 0.6;

/**
 * Distance band from fresh water (cells, jittered so the zones overlap): only river banks. Reed
 * and cattail beds are freshwater wetland plants; the sea shore stays free of them (the dune pass
 * still has its sparse beach grass).
 */
const getWetlandBand = (sample: PropSample, random: Random) => {
  const jitter = (random() - 0.5) * 0.8;
  if (sample.riverDistance < 4.2) return Math.max(0, sample.riverDistance - 0.5) + jitter;
  return undefined;
};

/** Species noise -1..1 at a spot: which plant dominates a stand (low frequency). */
export const createSpeciesNoise = (seed: number) => {
  const noise = createFbm(deriveSeed(seed, "species"), { octaves: 3 });
  return (x: number, z: number) => noise(x * 0.045, z * 0.045);
};

/** Patch noise -1..1 at a spot: forest clearings, meadow flower patches, the palm belt edge. */
export const createPatchNoise = (seed: number) => {
  const noise = createFbm(deriveSeed(seed, "patches"), { octaves: 3 });
  return (x: number, z: number) => noise(x * 0.11, z * 0.11);
};

/** Reeds and cattails form stands: the species noise decides which one dominates a stretch. */
export const chooseWaterEdgePlant = (species: number, random: Random) =>
  species + (random() - 0.5) * 0.7 > 0 ? PROP.cattail : PROP.reeds;

/**
 * Freshwater bank zonation: water -> reeds / cattails -> sedges -> river shrubs and young willows
 * -> grass, each in clusters; none in a river mouth. Sea beaches are handled by the dune pass.
 */
export const chooseShoreProp = (sample: PropSample, random: Random) => {
  if (sample.depth > SHALLOWS_DEPTH || sample.height > 3.5 || isRiverMouth(sample)) return NONE;
  const band = getWetlandBand(sample, random);
  if (band === undefined) return NONE;
  const cluster = getClusterFactor(sample);
  const roll = random();
  if (band < 1.3) {
    if (sample.depth < WATER_EDGE_MIN_DEPTH) return NONE;
    if (sample.sand > SAND_GROUND && sample.coast > WATER_EDGE_MAX_BEACH_COAST) return NONE;
    return roll < 0.5 + cluster * 0.5 ? chooseWaterEdgePlant(sample.species, random) : NONE;
  }
  if (sample.depth > 0.02) return NONE;
  if (band < 2.4) return roll < 0.3 + cluster * 0.55 ? PROP.sedge : NONE;
  if (band >= 3.8 || sample.coast < 1.6 || roll >= 0.04 + cluster * 0.3) return NONE;
  return random() < 0.35 ? PROP.willowShrub : PROP.riverShrub;
};
