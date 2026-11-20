import { smoothstep } from "../noise";
import type { Random } from "../rng";
import { PROP } from "../world-data";
import { chooseBirchForm, getBirchGroveChance, getBirchScale, getBirchWeight } from "./birch-rules";
import { chooseConiferForm, getConiferFacing } from "./conifer-rules";
import { choosePalmForm, getPalmScale } from "./palm-rules";
import {
  getClusterFactor,
  getEdgeFactor,
  isRockCovered,
  pickWeighted,
  type PropSample,
  SAND_GROUND} from "./prop-rules";

/** Closest a palm grows to the water line (the wet sand and foam band stay open). */
const PALM_COAST_MIN = 1.1;
/** Closest an inland tree grows to the water. */
const TREE_COAST_MIN = 1.6;
/** Palm belt depth (cells from the sea): full up to the first value, gone at the second. */
const PALM_BELT: [number, number] = [9, 24];
/** Palms stay on low ground: full below the first height, gone above the second. */
const PALM_LOWLAND: [number, number] = [2.2, 3.6];

/** What the palm rules read at a spot (the ground rules read it too, before the props stand). */
export type PalmSite = Pick<
  PropSample,
  "height" | "moisture" | "patches" | "sand" | "seaDistance" | "vegetation"
>;

/**
 * Coastal belt 0..1: low, dry ground near the sea, sand always. The patch noise moves the inner
 * border by a few cells, so the belt fades into the inland forest with ragged, overlapping edges.
 */
export const getCoastalWeight = (sample: PalmSite) => {
  const nearSea = 1 - smoothstep(...PALM_BELT, sample.seaDistance + sample.patches * 6);
  const lowland = 1 - smoothstep(...PALM_LOWLAND, sample.height + sample.patches * 0.4);
  const dryness = 0.55 + (1 - sample.moisture) * 0.45;
  return Math.max(smoothstep(0.1, SAND_GROUND, sample.sand), nearSea * lowland * dryness);
};

/**
 * Upland 0..1: high ground and the foot of the mountains. The species noise shifts both borders,
 * so conifer stands reach down a valley here and give way to broadleaf on a spur there.
 */
const getUplandWeight = (sample: PropSample) => {
  const altitude = smoothstep(2.6, 4.4, sample.height + sample.species * 0.7);
  const mountainFoot = 1 - smoothstep(2, 9, sample.mountainDistance - sample.species * 3);
  return Math.max(altitude, mountainFoot);
};

/** Palm weight 0..1 of the species mix: the theme's coastal belt, or its palm minimum inland. */
const getPalmDominance = (sample: PalmSite) => {
  // D-M4: palms are a warm-theme species; temperate coasts get conifers only.
  if (sample.vegetation.warmth <= 0) return 0;
  const { coastPalms, palm } = sample.vegetation;
  return Math.max(getCoastalWeight(sample) * coastPalms, palm);
};

/**
 * Share 0..1 of palms among the trees growing at a site (beach sand: palms only); the other
 * species share the rest. Palm groves are no forest: the ground keeps no forest floor there.
 */
export const getPalmShare = (sample: PalmSite) => {
  if (sample.vegetation.warmth <= 0) return 0;
  if (sample.sand >= SAND_GROUND) return 1;
  const dominance = getPalmDominance(sample);
  const palms = dominance ** 2;
  const others = (1 - dominance) ** 2;
  return palms / (palms + others);
};

/**
 * Species by site: palms on the sandy, dry coast, conifers on high ground and at the mountain
 * foot, broadleaf in the fertile lowland between, birches where a pioneer wins (birch-rules.ts).
 * Squared weights keep the zone cores pure (stands, no salt-and-pepper) while the bands between
 * them mix.
 */
export const chooseTreeSpecies = (sample: PropSample, random: Random) => {
  if (sample.sand >= SAND_GROUND)
    return sample.vegetation.warmth > 0 ? PROP.palmTree : PROP.coniferTree;
  const coastal = getPalmDominance(sample);
  const upland = Math.max(getUplandWeight(sample), sample.vegetation.conifer) * (1 - coastal);
  const lowland = (1 - coastal) * (1 - upland) * (0.8 + sample.moisture * 0.4) * sample.vegetation.broadleaf;
  const birch = (1 - coastal) * getBirchWeight(sample, upland);
  return pickWeighted(
    [
      [PROP.palmTree, coastal * coastal],
      [PROP.coniferTree, upland * upland],
      [PROP.birchTree, birch * birch],
      [PROP.broadleafTree, lowland * lowland]
    ],
    random
  );
};

/**
 * Owner 2026-10-18: new maps grow ordinary softwood, pine inland and palms on suitable coastal
 * ground, drawn from the same site ecology (one species draw). Expedition themes and selected
 * colony pairs apply their explicit ecology afterwards.
 */
export const chooseSoftwoodSpecies = (sample: PropSample, random: Random) =>
  chooseTreeSpecies(sample, random) === PROP.palmTree ? PROP.palmTree : PROP.coniferTree;

/** Structural form byte of a new tree (tree-forms.ts); 0 for kinds without forms. */
export const chooseTreeForm = (sample: PropSample, kind: number, random: Random) => {
  if (kind === PROP.birchTree) return chooseBirchForm(sample, random);
  if (kind === PROP.coniferTree) return chooseConiferForm(sample, random);
  if (kind === PROP.palmTree) return choosePalmForm(sample, random);
  return 0;
};

/** Fixed facing of a new tree (radians), undefined for a random one. */
export const getTreeFacing = (sample: PropSample, kind: number, form: number) =>
  kind === PROP.coniferTree ? getConiferFacing(sample, form) : undefined;

/** Ground no tree can root in: water, plateaus, rock, cliffs and the sculpted mountain skin. */
const isTreeless = (sample: PropSample) =>
  sample.depth > 0 ||
  sample.plateau > 0.25 ||
  sample.rock > 0.55 ||
  sample.slope > 1.1 ||
  isRockCovered(sample);

/** Water distance (cells) over which inland groves fade to the theme's inland share. */
const GROVE_WATER_REACH: [number, number] = [4, 10];

/**
 * Loose palm groves along the coastal belt (cluster noise: groups with gaps, never a hedge);
 * away from water the theme's inland grove share applies (desert dunes: oases at the water); a
 * cold theme keeps none (coastPalms).
 * Sandy ground keeps palms however deep inland it lies, at the theme's sand palm share.
 */
const getPalmGroveChance = (sample: PropSample) => {
  if (sample.vegetation.warmth <= 0) return 0;
  const nearWater = 1 - smoothstep(...GROVE_WATER_REACH, sample.coast);
  const { coastPalms, inlandGroves, sandPalms } = sample.vegetation;
  const sandy = smoothstep(0.1, SAND_GROUND, sample.sand) * sandPalms;
  const share = Math.max(sandy, inlandGroves + (1 - inlandGroves) * nearWater);
  return getCoastalWeight(sample) * getClusterFactor(sample) * 0.5 * share * coastPalms;
};

/**
 * Open woodland at the forest edge: the chance falls off towards the edge, so the trunks stand
 * further apart there (about 2.2+ cells) than in the core (about 1.8, near the Poisson spacing).
 */
const getCoreDensity = (forest: number) => 0.35 + 0.65 * smoothstep(0.3, 0.75, forest);

/** Forest stands from the forest mask: clearings inside, thinning edges, lone meadow trees. */
const getForestChance = (sample: PropSample) => {
  const clearing = smoothstep(0.35, 0.6, sample.patches) * smoothstep(0.4, 0.8, sample.forest);
  const glades = 1 - clearing * 0.85 * sample.vegetation.glades;
  const forest = Math.pow(sample.forest, 0.7) * glades * getCoreDensity(sample.forest);
  const lone = (0.012 + sample.moisture * 0.01) * sample.vegetation.solitaryTrees;
  const solitary = sample.forest < 0.05 ? lone : 0;
  const timberline = 1 - smoothstep(4.5, 6.5, sample.height) * 0.75;
  const heatStress = 1 - smoothstep(0.55, 0.85, sample.heatLoad) * 0.3;
  const exposureStress = 1 - Math.max(0, sample.exposure) * 0.15;
  return (forest * 1.05 + getEdgeFactor(sample.forest) * 0.15 + solitary) * timberline *
    heatStress * exposureStress;
};

/** Probability that a tree spot (Poisson, props.ts TREE_SPACING) gets a tree. */
export const getTreeChance = (sample: PropSample) => {
  if (sample.coast < PALM_COAST_MIN || isTreeless(sample)) return 0;
  const palms = getPalmGroveChance(sample);
  if (sample.coast < TREE_COAST_MIN || sample.sand >= SAND_GROUND) return palms;
  const birchGroves = getBirchGroveChance(sample) * (1 - getCoastalWeight(sample));
  return Math.min(1, Math.max(palms, getForestChance(sample), birchGroves));
};

/**
 * New maps start with a mature forest. Remaining scale variation is site-driven size, not a
 * young growth stage: every generated tree maps to growth stage 5.
 */
export const getTreeScale = (sample: PropSample, kind: number, random: Random, form = 0) => {
  if (kind === PROP.birchTree) return getBirchScale(sample, form, random);
  if (kind === PROP.palmTree) return getPalmScale(sample, form, random);
  if (sample.forest < 0.05) return 1.12 + random() * 0.18;
  const age = smoothstep(0.2, 0.8, sample.forest);
  return 1.08 + age * 0.08 + random() * 0.12;
};
