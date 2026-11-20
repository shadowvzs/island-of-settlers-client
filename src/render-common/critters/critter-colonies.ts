import { smoothstep } from "../../shared/world/noise";
import { type Random,randomInt } from "../../shared/world/rng";
import type { EnvironmentState } from "../environment";
import { CRITTER, type CritterId } from "./critter-species";
import {
  type HabitatScore,
  scoreBeach,
  scoreCalmWater,
  scoreForestEdge,
  scoreMountainForest,
  scoreOpenWoods,
  scoreRiverFish,
  scoreSeaFish,
  scoreShallows,
  scoreWoods} from "./habitat/critter-habitats";
import { scoreMountainFoot, scorePeak, scoreRockySlope } from "./habitat/critter-habitats-mountain";
import {
  scoreCrabBeach,
  scoreFrogBank,
  scoreMeadowEdge,
  scoreSealShore,
  scoreStillWater
} from "./habitat/critter-habitats-shore";

/** How the members of a colony live (the simulation module that moves them). */
export const BEHAVIOUR = {
  swim: 0,
  wade: 1,
  shore: 2,
  leap: 3,
  roam: 4,
  climb: 5,
  soar: 6,
  burrow: 7,
  hop: 8,
  scuttle: 9,
  haul: 10,
  dart: 11
} as const;
export type Behaviour = (typeof BEHAVIOUR)[keyof typeof BEHAVIOUR];

/**
 * A kind of critter home: where its sites are (habitat, spacing, how many per island), who
 * lives there, how they behave, and how many show around the view (zoom, cap, time of day).
 */
export interface CritterColony {
  /** Share of the sites occupied at this time of day and weather (0..1). */
  activity: (environment: EnvironmentState) => number;
  behaviour: Behaviour;
  /** Height its members are seen at above the site (soaring eagles; 0 without). */
  flight?: number;
  habitat: HabitatScore;
  /** The species of one site's members (the first leads, the others follow or keep near). */
  members: (random: Random) => CritterId[];
  /** Below this zoom the colony is not simulated or drawn (too small to read). */
  minZoom: number;
  name: string;
  /** Sites on a 256 x 256 cell island (scaled by the island area). */
  perIsland: number;
  /**
   * Homes only where the iso camera sees the ground (no crown, ridge or rock in front, no
   * rendered rock on the spot).
   */
  inSight?: boolean;
  /** World units the members roam around their site. */
  range: number;
  /** Minimum distance between two sites of the colony. */
  spacing: number;
  /** Most sites of the colony occupied around the view at once. */
  viewCap: number;
  /** Share of the sites kept in full winter (snowy theme). */
  winter: number;
}

const always = () => 1;
/** Fewer about at night (the rest sleep somewhere out of sight). */
const dayActive = (night: number) => (environment: EnvironmentState) =>
  night + (1 - night) * smoothstep(0.15, 0.6, environment.daylight);

const repeat = (species: CritterId, count: number) => new Array<CritterId>(count).fill(species);

/** A sow with her striped piglets, or a few young boars together. */
const pickBoars = (random: Random): CritterId[] => {
  if (random() < 0.6) return [CRITTER.boar, ...repeat(CRITTER.piglet, 2 + randomInt(random, 4))];
  return repeat(CRITTER.boar, 2 + randomInt(random, 2));
};

/** A few does and their kids, or a small band of young bucks. */
const pickChamois = (random: Random): CritterId[] => {
  const adults = repeat(CRITTER.chamois, 2 + randomInt(random, 3));
  if (random() < 0.4) return adults;
  return [...adults, ...repeat(CRITTER.chamoisKid, 1 + randomInt(random, 2))];
};

/** One burrow (the leader, it stays) and the marmots living in it. */
const pickMarmots = (random: Random): CritterId[] => [
  CRITTER.burrow,
  ...repeat(CRITTER.marmot, 1 + randomInt(random, 2))
];

/** Out mostly at dusk and by night; a few by day. */
const nightActive = (environment: EnvironmentState) =>
  0.35 + 0.65 * (1 - smoothstep(0.15, 0.6, environment.daylight));

/** Warm dry daylight only (insects). */
const sunnyActive = (environment: EnvironmentState) =>
  (1 - environment.rain) * smoothstep(0.35, 0.75, environment.daylight);

/** A hen leading a brood, or a few drakes and hens together. */
const pickDucks = (random: Random): CritterId[] => {
  if (random() < 0.35)
    return [CRITTER.mallardHen, ...repeat(CRITTER.duckling, 3 + randomInt(random, 4))];
  const drakes = 1 + randomInt(random, 2);
  const hens = 1 + randomInt(random, 2);
  return [...repeat(CRITTER.mallardDrake, drakes), ...repeat(CRITTER.mallardHen, hens)];
};

export const CRITTER_COLONIES: readonly CritterColony[] = [
  {
    activity: always,
    behaviour: BEHAVIOUR.swim,
    habitat: scoreCalmWater,
    members: pickDucks,
    minZoom: 0.55,
    name: "mallards",
    perIsland: 12,
    range: 3.2,
    spacing: 11,
    viewCap: 3,
    winter: 0.5
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.wade,
    habitat: scoreShallows,
    members: () => [CRITTER.heron],
    minZoom: 0.5,
    name: "herons",
    perIsland: 9,
    range: 2.6,
    spacing: 14,
    viewCap: 2,
    winter: 0.35
  },
  {
    activity: dayActive(0.45),
    behaviour: BEHAVIOUR.shore,
    habitat: scoreBeach,
    members: (random) => repeat(CRITTER.gull, 2 + randomInt(random, 4)),
    minZoom: 0.55,
    name: "beach gulls",
    perIsland: 10,
    range: 2.4,
    spacing: 13,
    viewCap: 3,
    winter: 0.8
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.leap,
    habitat: scoreRiverFish,
    members: () => [CRITTER.trout],
    minZoom: 0.7,
    name: "river trout",
    perIsland: 34,
    range: 1.6,
    spacing: 6,
    viewCap: 6,
    winter: 1
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.leap,
    habitat: scoreSeaFish,
    members: () => [CRITTER.mackerel],
    minZoom: 0.7,
    name: "sea mackerel",
    perIsland: 40,
    range: 2.2,
    spacing: 8,
    viewCap: 6,
    winter: 1
  },
  {
    activity: dayActive(0.6),
    behaviour: BEHAVIOUR.roam,
    habitat: scoreForestEdge,
    members: () => [CRITTER.fox],
    minZoom: 0.55,
    inSight: true,
    name: "foxes",
    perIsland: 8,
    range: 5,
    spacing: 18,
    viewCap: 2,
    winter: 0.8
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.roam,
    habitat: scoreOpenWoods,
    members: pickBoars,
    minZoom: 0.5,
    inSight: true,
    name: "wild boars",
    perIsland: 6,
    range: 5,
    spacing: 22,
    viewCap: 2,
    winter: 0.6
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.roam,
    habitat: scoreMountainForest,
    members: (random) => repeat(CRITTER.wolf, 3 + randomInt(random, 3)),
    minZoom: 0.45,
    inSight: true,
    name: "wolf packs",
    perIsland: 2,
    range: 7,
    spacing: 45,
    viewCap: 1,
    winter: 1
  },
  {
    activity: dayActive(0.1),
    behaviour: BEHAVIOUR.climb,
    habitat: scoreWoods,
    members: (random) => repeat(CRITTER.squirrel, random() < 0.3 ? 2 : 1),
    minZoom: 0.7,
    name: "squirrels",
    perIsland: 14,
    range: 2.2,
    spacing: 9,
    viewCap: 4,
    winter: 0.7
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.roam,
    habitat: scoreMountainForest,
    members: () => [CRITTER.bear],
    minZoom: 0.45,
    inSight: true,
    name: "brown bears",
    perIsland: 1.5,
    range: 6,
    spacing: 50,
    viewCap: 1,
    winter: 0.7
  },
  {
    activity: dayActive(0.3),
    behaviour: BEHAVIOUR.roam,
    habitat: scoreRockySlope,
    members: pickChamois,
    minZoom: 0.5,
    inSight: true,
    name: "chamois",
    perIsland: 6,
    range: 6,
    spacing: 20,
    viewCap: 2,
    winter: 0.8
  },
  {
    activity: dayActive(0),
    behaviour: BEHAVIOUR.burrow,
    habitat: scoreMountainFoot,
    members: pickMarmots,
    minZoom: 0.65,
    inSight: true,
    name: "marmots",
    perIsland: 16,
    range: 1.2,
    spacing: 4,
    viewCap: 5,
    winter: 0.1
  },
  {
    activity: dayActive(0),
    behaviour: BEHAVIOUR.soar,
    flight: 3.8,
    habitat: scorePeak,
    members: (random) => repeat(CRITTER.eagle, random() < 0.3 ? 2 : 1),
    minZoom: 0.4,
    name: "golden eagles",
    perIsland: 3,
    range: 6,
    spacing: 40,
    viewCap: 1,
    winter: 0.8
  },
  {
    activity: nightActive,
    behaviour: BEHAVIOUR.roam,
    habitat: scoreMeadowEdge,
    inSight: true,
    members: (random) => repeat(CRITTER.hedgehog, random() < 0.2 ? 2 : 1),
    minZoom: 0.65,
    name: "hedgehogs",
    perIsland: 10,
    range: 2.5,
    spacing: 12,
    viewCap: 2,
    winter: 0
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.hop,
    habitat: scoreFrogBank,
    members: (random) => repeat(CRITTER.frog, 1 + randomInt(random, 3)),
    minZoom: 0.75,
    name: "frogs",
    perIsland: 24,
    range: 1.4,
    spacing: 5,
    viewCap: 4,
    winter: 0
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.scuttle,
    habitat: scoreCrabBeach,
    members: (random) => repeat(CRITTER.crab, 2 + randomInt(random, 3)),
    minZoom: 0.75,
    name: "crabs",
    perIsland: 16,
    range: 1.8,
    spacing: 7,
    viewCap: 4,
    winter: 0.5
  },
  {
    activity: always,
    behaviour: BEHAVIOUR.haul,
    habitat: scoreSealShore,
    inSight: true,
    members: (random) => repeat(CRITTER.seal, 1 + randomInt(random, 3)),
    minZoom: 0.45,
    name: "seals",
    perIsland: 4,
    range: 3,
    spacing: 28,
    viewCap: 2,
    winter: 1
  },
  {
    activity: sunnyActive,
    behaviour: BEHAVIOUR.dart,
    habitat: scoreStillWater,
    members: (random) => repeat(CRITTER.dragonfly, random() < 0.4 ? 2 : 1),
    minZoom: 0.75,
    name: "dragonflies",
    perIsland: 14,
    range: 1.8,
    spacing: 6,
    viewCap: 3,
    winter: 0
  }
];
