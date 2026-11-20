import { smoothstep } from "../noise";
import type { Random } from "../rng";
import { COMPETITION, CONIFER, encodeTreeForm, getFormCompetition } from "../tree-forms";
import { pickWeighted, type PropSample } from "./prop-rules";

/** Forest mask from which a tree stands in the closed forest interior. */
const INTERIOR_FOREST = 0.88;
/** Below this forest mask a tree grows open (meadow, open woodland). */
const OPEN_FOREST = 0.55;
/** Forest mask slope (per cell) from which the stand clearly thins to one side: an edge. */
const EDGE_GRADIENT = 0.15;

/** Clearings inside the forest (prop-rules patches noise). */
const getClearingFactor = (sample: PropSample) =>
  smoothstep(0.35, 0.6, sample.patches) * smoothstep(0.4, 0.8, sample.forest);

const getForestSlope = (sample: PropSample) => Math.hypot(sample.forestSlopeX, sample.forestSlopeZ);

/**
 * Shape from the local forest density (forest mask): open-grown in meadows, clearings and open
 * woodland, interior in the closed forest, edge where the mask falls off to one side.
 */
export const getCompetition = (sample: PropSample) => {
  const density = sample.forest + sample.grain * 0.06;
  if (density < OPEN_FOREST || getClearingFactor(sample) > 0.5) return COMPETITION.open;
  if (getForestSlope(sample) > EDGE_GRADIENT) return COMPETITION.edge;
  return density > INTERIOR_FOREST ? COMPETITION.interior : COMPETITION.open;
};

/** How strongly the stand noise separates spruce stands from tall forest pine stands. */
const STAND_CONTRAST = 3;

/**
 * The band between spruce and pine stands (stand noise near 0): mixed forest where the tall
 * forest pine also grows inside the closed forest.
 */
const getMixedBand = (sample: PropSample) =>
  0.35 + 1.3 * Math.exp(-12 * sample.stand * sample.stand);

/** Ridges, high ground and the rock's edge: mountain pine country. */
const getRidgeWeight = (sample: PropSample) =>
  Math.max(smoothstep(4.9, 6, sample.height), 1 - smoothstep(2, 3.4, sample.mountainDistance));

/** Open ground and clearings close to the rock (mountain pine, not the tall forest pine). */
const getNearRockWeight = (sample: PropSample) => 1 - smoothstep(3.4, 9, sample.mountainDistance);

/**
 * Archetype weights at a spot: the stand noise clusters spruce and tall forest pine regions,
 * ridges get mountain pine, clearings and open woodland the open-grown tall forest pine (mountain
 * pine near the rock); warm themes keep no cool spruce stands: the open-grown tall forest pine
 * takes their place.
 */
export const getArchetypeWeights = (
  sample: PropSample,
  competition: number
): [number, number][] => {
  const ridge = getRidgeWeight(sample);
  const lowland = 1 - ridge * 0.75;
  const warm = sample.vegetation.warmth;
  const cool = Math.pow(1 - warm, 2);
  const open = competition === COMPETITION.interior ? 0 : 1;
  const interior = 1 - open;
  const clearing = getClearingFactor(sample);
  const openLand = (1 + open * 0.8 + clearing * 1.5) * lowland;
  const nearRock = getNearRockWeight(sample);
  const pineStand = 0.2 * Math.exp(-STAND_CONTRAST * sample.stand) * openLand * (1 - nearRock);
  const mixedForest = 0.25 * (0.5 + interior * 1.2) * getMixedBand(sample) * (1 - warm) * lowland;
  const warmPines = 0.5 * warm * openLand;
  const exposedMountain = smoothstep(0.5, 0.8, sample.exposure) *
    smoothstep(3, 5, sample.height);
  const hollowSpruce = 1 + sample.curvature * 0.3 - Math.max(0, sample.heatLoad) * 0.25;
  return [
    [CONIFER.spruce,
      0.4 * Math.exp(STAND_CONTRAST * sample.stand) * cool * lowland * Math.max(0.4, hollowSpruce)],
    [CONIFER.lodgepole, pineStand + mixedForest + warmPines],
    [CONIFER.mountain,
      0.05 + 2 * ridge + 0.3 * nearRock * (open * 0.5 + clearing) + exposedMountain * 0.6]
  ];
};

/** Conifer form byte: archetype by site, competition form by the local forest density. */
export const chooseConiferForm = (sample: PropSample, random: Random) => {
  const competition = getCompetition(sample);
  const archetype = pickWeighted(getArchetypeWeights(sample, competition), random);
  return encodeTreeForm(archetype, competition);
};

/**
 * Instance rotation of an edge conifer: its mesh grows the heavy side along +x; turned towards
 * where the forest thins (down the forest mask). Other trees keep a random rotation.
 */
export const getConiferFacing = (sample: PropSample, form: number) => {
  if (getFormCompetition(form) !== COMPETITION.edge) return undefined;
  return Math.atan2(sample.forestSlopeZ, -sample.forestSlopeX);
};
