import type { WorkerNation } from "../../workers/worker-unit";
import type { BuildingDefinition } from "../building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "../building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "../building-recipe-fit";
import { getRomanBuildingWorldSizing } from "../building-world-sizing";
import { classifyNationBody, type RoofEnvelope, type WallRun } from "../nation-kit-classify";
import { bodyCenter, type DoorGap, doorGapOf } from "../nation-kit-parts";
import type { BodyLift } from "./level-lift";
import { roofTopAt } from "./level-roof-surface";

/** Ridge of the main roof: the horizontal axis it runs along, or null on a flat terrace. */
interface LevelRoof {
  /** Plan envelope of the main roof. */
  envelope: RoofEnvelope;
  centre: Point3;
  ridgeAxis: 0 | 2 | null;
  /** Height of the ridge (or terrace) over the roof centre. */
  top: number;
  /** Lowest edge of the roof (its eave). */
  eave: number;
}

/** A round tower body standing on the ground: the nation built it round on a square plan. */
export interface RoundShaft { x: number; z: number; radius: number; top: number }

export interface LevelSite {
  definition: BuildingDefinition;
  nation: WorkerNation;
  detailed: boolean;
  centre: Point3;
  door: DoorGap;
  /** Plan walls the nation actually built (those inside a round tower body are left out). */
  walls: readonly WallRun[];
  roundShafts: readonly RoundShaft[];
  roof: LevelRoof | null;
  /** Half extents of the original plot envelope. */
  limit: { extentX: number; extentZ: number };
  /** Tallest point of the level 1 model: additions stay within 130 % of it. */
  baseHeight: number;
  /** The raised band (level 3+): where the walls were cut and how far everything above rose. */
  lift: BodyLift | null;
  /** The building as dressed so far (its own parts first, additions after). */
  parts: BuildingPart[];
  /** The building's level 1 anchors (door, worker exit, work point). */
  recipe: BuildingRecipe;
  /** Model scale of recipe units in fitted grid units. */
  scale: number;
  topAt: (x: number, z: number) => number | null;
  /** The roof under any dome or spire standing on it (a terrace deck, a ridge). */
  deckAt: (x: number, z: number) => number | null;
}

const RIDGE_SAMPLES = [-.2, -.1, 0, .1, .2];
/** A roof whose heights vary less than this along both centre lines is a flat terrace. */
const FLAT_RANGE = .06;

const largestRoof = (roofs: readonly RoofEnvelope[]) => roofs.reduce<RoofEnvelope | undefined>((best, roof) => {
  const area = (envelope: RoofEnvelope) => (envelope.max[0] - envelope.min[0]) * (envelope.max[2] - envelope.min[2]);
  return !best || area(roof) > area(best) ? roof : best;
}, undefined);

const sampleLine = (topAt: LevelSite["topAt"], envelope: RoofEnvelope, axis: 0 | 2) => {
  const centre = [(envelope.min[0] + envelope.max[0]) / 2, (envelope.min[2] + envelope.max[2]) / 2] as const;
  const span = envelope.max[axis]! - envelope.min[axis]!;
  return RIDGE_SAMPLES.flatMap(fraction => {
    const x = axis === 0 ? centre[0] + fraction * span : centre[0];
    const z = axis === 2 ? centre[1] + fraction * span : centre[1];
    const height = topAt(x, z);
    return height === null ? [] : [height];
  });
};

const range = (values: readonly number[]) => values.length ? Math.max(...values) - Math.min(...values) : Infinity;

const ridgeAxisOf = (alongX: readonly number[], alongZ: readonly number[]): LevelRoof["ridgeAxis"] => {
  if (range(alongX) < FLAT_RANGE && range(alongZ) < FLAT_RANGE) return null;
  return range(alongX) <= range(alongZ) ? 0 : 2;
};

/** Finds the ridge by sampling the dressed roof: it varies least along the ridge line. */
const analyseRoof = (envelope: RoofEnvelope | undefined, topAt: LevelSite["topAt"]): LevelRoof | null => {
  if (!envelope) return null;
  const alongX = sampleLine(topAt, envelope, 0), alongZ = sampleLine(topAt, envelope, 2);
  if (!alongX.length && !alongZ.length) return null;
  const centre: Point3 = [(envelope.min[0] + envelope.max[0]) / 2, envelope.min[1],
    (envelope.min[2] + envelope.max[2]) / 2];
  const ridgeAxis = ridgeAxisOf(alongX, alongZ);
  const ridge = ridgeAxis === 2 ? alongZ : alongX;
  return { centre, eave: envelope.min[1], envelope, ridgeAxis, top: Math.max(...ridge) };
};

export const recipeHeight = (parts: readonly BuildingPart[]) =>
  parts.reduce((top, part) => Math.max(top, getRomanPartBounds(part).max[1]), 0);

/** How far either side of a point a ridge gap may open between two slopes (Minimal slabs). */
const RIDGE_GAP = .06;

/**
 * A plan point in the slit where two roof slopes meet without a ridge piece (Minimal Viking roofs)
 * reads the higher slope beside it; points past an eave stay uncovered.
 */
const bridgeRidgeGaps = (top: LevelSite["topAt"]): LevelSite["topAt"] => (x, z) => {
  const direct = top(x, z);
  if (direct !== null) return direct;
  let bridged: number | null = null;
  for (const [dx, dz] of [[RIDGE_GAP, 0], [0, RIDGE_GAP]] as const) {
    const before = top(x - dx, z - dz), after = top(x + dx, z + dz);
    if (before !== null && after !== null) bridged = Math.max(bridged ?? -Infinity, before, after);
  }
  return bridged;
};

/** Upright cylinders at least this wide and tall, standing on the ground, are round tower bodies. */
const SHAFT = { minDiameter: .5, minHeight: .8 } as const;
/** A body this wide replaces the square plan's walls round it (narrower corner towers only add to them). */
const BODY_RADIUS = .4;
const WALL_MARGIN = .25;

export const findRoundShafts = (parts: readonly BuildingPart[]): RoundShaft[] => parts.flatMap(part => {
  if (part.shape !== "cylinder" || part.stock || part.rotation) return [];
  const { max, min } = getRomanPartBounds(part);
  const wide = Math.min(part.size[0], part.size[2]) >= SHAFT.minDiameter;
  if (!wide || part.size[1] < SHAFT.minHeight || min[1] > .05) return [];
  return [{ radius: Math.min(part.size[0], part.size[2]) / 2, top: max[1], x: part.position[0], z: part.position[2] }];
});

const insideRoundBody = (wall: WallRun, shafts: readonly RoundShaft[]) => {
  const x = (wall.min[0] + wall.max[0]) / 2, z = (wall.min[2] + wall.max[2]) / 2;
  return shafts.some(shaft => Math.hypot(x - shaft.x, z - shaft.z) < shaft.radius + WALL_MARGIN);
};

/**
 * Where the level additions go: the wall runs and main roof of the (raised) Roman plan the nation
 * built on, the dressed roof surface, door, plot envelope and the level 1 height.
 */
export const analyseLevelSite = (input: {
  definition: BuildingDefinition; nation: WorkerNation; detailed: boolean;
  plan: BuildingRecipe; built: BuildingRecipe; baseline: BuildingRecipe; lift: BodyLift | null;
}): LevelSite => {
  const { baseline, built, definition, detailed, lift, nation, plan } = input;
  const body = classifyNationBody(plan);
  const topAt = bridgeRidgeGaps((x, z) => roofTopAt(built.parts, x, z, detailed));
  const deckAt = bridgeRidgeGaps((x, z) => roofTopAt(built.parts, x, z, detailed, true));
  const roundShafts = findRoundShafts(built.parts).filter(shaft => shaft.radius >= BODY_RADIUS);
  return {
    baseHeight: recipeHeight(baseline.parts), centre: bodyCenter(body.walls), deckAt, definition, detailed, door: doorGapOf(built),
    lift, limit: getRomanRecipeBounds(definition, baseline), nation, parts: [...built.parts], recipe: built,
    scale: getRomanBuildingWorldSizing(definition).scale,
    roof: analyseRoof(largestRoof(body.roofs), deckAt), roundShafts, topAt,
    walls: body.walls.filter(wall => !insideRoundBody(wall, roundShafts))
  };
};
