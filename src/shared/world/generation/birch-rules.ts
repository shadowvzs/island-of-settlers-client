import { smoothstep } from "../noise";
import type { Random } from "../rng";
import { BIRCH, encodeTreeForm, getFormArchetype } from "../tree-forms";
import { getEdgeFactor, pickWeighted, type PropSample } from "./prop-rules";

/** Water distance (cells) over which the birch's wet bank habitat fades out. */
const BANK_REACH: [number, number] = [1.5, 6];

/** River, lake and sea banks 0..1 (the coastal belt itself is palm land). */
const getBankFactor = (sample: PropSample) =>
  (1 - smoothstep(...BANK_REACH, sample.coast)) * (0.5 + sample.moisture * 0.5);

const getClearingFactor = (sample: PropSample) =>
  smoothstep(0.35, 0.6, sample.patches) * smoothstep(0.4, 0.8, sample.forest);

/** Grove noise band: small pure birch stands (5-25 trees) where the grove noise peaks. */
const GROVE_NOISE: [number, number] = [0.44, 0.47];
/** Grove site weight: a birch grove beats the oak (nearly pure birch stands). */
const GROVE_WEIGHT = 5;

const getGroveFactor = (sample: PropSample) => smoothstep(...GROVE_NOISE, sample.grove);

/**
 * Light for a pioneer 0..1: open land, forest edges, clearings and banks; nearly 0 under a
 * closed oak canopy (a birch does not survive its shade).
 */
const getLightFactor = (sample: PropSample) =>
  Math.max(
    1 - smoothstep(0.3, 0.6, sample.forest),
    getClearingFactor(sample),
    getBankFactor(sample)
  );

/** Pine stands (tall forest pine on the poor, sandy ground birches share): low stand noise. */
const getPineAffinity = (sample: PropSample) => smoothstep(-0.05, -0.5, sample.stand);

/** Grove noise in the light, 0..1 (a pure stand there). */
const getLitGrove = (sample: PropSample) => getGroveFactor(sample) * getLightFactor(sample);

/** Dry ground (the local theme's moisture) keeps birches rare. */
const getMoistureFactor = (sample: PropSample) => 0.4 + sample.moisture * 0.6;

/**
 * Silver birch site weight (before squaring, like the other species). A light demanding
 * pioneer: mostly its own small groves (grove noise) on open ground, edges, clearings and banks;
 * mixed into conifer stands (more with pine than spruce) and the pine / oak transition band;
 * scattered at edges, on banks and as lone meadow trees; about none inside closed oak cores.
 * `upland`: the conifer zone weight 0..1.
 */
export const getBirchWeight = (sample: PropSample, upland: number) => {
  const open = 1 - smoothstep(0.3, 0.6, sample.forest);
  const grove = getGroveFactor(sample) * getLightFactor(sample) ** 2 * GROVE_WEIGHT;
  const transition = 4 * upland * (1 - upland);
  const conifer = upland * (0.15 + getPineAffinity(sample) * 0.85) + transition * 0.6;
  const edge = open * (0.02 + getEdgeFactor(sample.forest) * 0.06);
  const lone = sample.forest < 0.05 ? 0.15 : 0;
  const scattered = edge + getBankFactor(sample) * 0.12 + lone;
  return Math.max(grove, conifer, scattered) * getMoistureFactor(sample);
};

/** Extra tree chance of a birch grove on open land (heath-like meadow patches). */
export const getBirchGroveChance = (sample: PropSample) =>
  getLitGrove(sample) * Math.sqrt(getMoistureFactor(sample)) * sample.vegetation.solitaryTrees;

/**
 * Birch structure by site: weeping birches mostly on the banks, multi-trunk clumps in groves and
 * clearings, classic trees inside the forest, old rugged ones as lone meadow trees. New maps start
 * with mature trees, so the young single-stem form is not used by generated maps.
 */
export const chooseBirchForm = (sample: PropSample, random: Random) => {
  const lone = sample.forest < 0.05 ? 1 : 0;
  const archetype = pickWeighted(
    [
      [BIRCH.weeping, 0.15 + getBankFactor(sample) * 2.2],
      [BIRCH.multiStem, 0.3 + getClearingFactor(sample) * 1.2 + getLitGrove(sample) * 0.8],
      [BIRCH.old, 0.06 + lone * 0.6],
      [BIRCH.classic, 0.9 + smoothstep(0.4, 0.8, sample.forest) * 0.6]
    ],
    random
  );
  return encodeTreeForm(archetype, 0);
};

/** Age (placement scale): generated birches are mature, with only a small site-driven size spread. */
export const getBirchScale = (sample: PropSample, form: number, random: Random) => {
  const archetype = getFormArchetype(form);
  if (archetype === BIRCH.old) return 1.12 + random() * 0.18;
  const age = smoothstep(0.2, 0.8, sample.forest);
  const bank = archetype === BIRCH.weeping ? 0.04 : 0;
  return 1.08 + age * 0.08 + bank + random() * 0.12;
};
