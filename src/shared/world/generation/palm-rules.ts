import { smoothstep } from "../noise";
import type { Random } from "../rng";
import { COMPETITION, encodeTreeForm, getFormArchetype, PALM } from "../tree-forms";
import { getClusterFactor, pickWeighted, type PropSample,SAND_GROUND } from "./prop-rules";

/** The old leaning hero palm: rare, only where the beach meets the sea. */
const LEANING_WEIGHT = 0.035;

/** Sandy beach 0..1 (the coconut's ground). */
const getBeachFactor = (sample: PropSample) => smoothstep(0.1, SAND_GROUND, sample.sand);

/** Dry ground 0..1: low moisture, or a dry local theme (desert: high theme palm weight). */
const getDryFactor = (sample: PropSample) =>
  Math.max(smoothstep(0.72, 0.94, 1 - sample.moisture), sample.vegetation.palm);

/** Rocky warm spots: rock share in the ground or rough slopes. */
const getRockyFactor = (sample: PropSample) =>
  Math.min(1, smoothstep(0.08, 0.4, sample.rock) + smoothstep(0.35, 0.9, sample.surfaceSlope));

/** Banks of rivers and lakes away from the beach, and the forest understorey. */
const getShelterFactor = (sample: PropSample) => {
  const bank = (1 - smoothstep(1.5, 5, sample.coast)) * (1 - getBeachFactor(sample));
  return Math.max(bank, smoothstep(0.2, 0.6, sample.forest));
};

/**
 * Spatial clusters: every variant prefers its own regions of the low and medium frequency
 * noises, so neighbouring palms mostly share a variant (groves, not salt and pepper).
 */
export const getPalmClusterPreference = (sample: PropSample, archetype: number) => {
  const field =
    Math.sin(sample.species * 4.1 + archetype * 1.9) * 0.6 +
    Math.cos(sample.stand * 3.3 + archetype * 2.7) * 0.4;
  return 0.12 + 2 * smoothstep(-0.1, 0.6, field);
};

/**
 * Variant weights by site: coconuts on the beach and the coast, date palms on dry ground and in
 * the desert, fan palms on dry inland and rocky warm spots, pygmy date and ground palms by the
 * water and in the understorey; the old leaning hero rarely, at the beach edge.
 */
const getPalmWeights = (sample: PropSample): [number, number][] => {
  const beach = getBeachFactor(sample);
  const nearSea = 1 - smoothstep(2, 12, sample.seaDistance);
  const inland = smoothstep(4, 14, sample.seaDistance);
  const dry = getDryFactor(sample);
  const rocky = getRockyFactor(sample);
  const shelter = getShelterFactor(sample);
  const weights: [number, number][] = [
    [PALM.coconut, (0.35 + beach * 1.6 + nearSea * 0.9) * (1 - dry * 0.4)],
    [PALM.date, 0.08 + dry * 1.5 * (0.35 + inland)],
    [PALM.fan, 0.04 + dry * inland * 0.8 + rocky * dry * 1.3],
    [PALM.pygmyDate, 0.04 + shelter * 0.45],
    [PALM.ground, 0.04 + shelter * 0.5 * (1 - dry * 0.5)]
  ];
  const clustered = weights.map(([archetype, weight]): [number, number] => [
    archetype,
    weight * getPalmClusterPreference(sample, archetype)
  ]);
  return [...clustered, [PALM.leaning, LEANING_WEIGHT * (beach + nearSea * 0.3) * nearSea]];
};

/** Palm form byte: variant by site (palms always grow open). */
export const choosePalmForm = (sample: PropSample, random: Random) =>
  encodeTreeForm(pickWeighted(getPalmWeights(sample), random), COMPETITION.open);

/**
 * New maps start with mature palms. The form still varies by site (the leaning hero, small
 * ground/pygmy species); placement scale stays in the mature age band.
 */
export const getPalmScale = (sample: PropSample, form: number, random: Random) => {
  const archetype = getFormArchetype(form);
  if (archetype === PALM.leaning) return 1.15 + random() * 0.15;
  return 1.08 + getClusterFactor(sample) * 0.08 + random() * 0.12;
};
