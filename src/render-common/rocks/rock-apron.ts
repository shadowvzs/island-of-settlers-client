import { smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import type { GeologyMap } from "./geology";
import {
  createUprightFrame,
  ROCK_ROLE,
  type RockInstance,
  scaleFrame,
  tiltFrame} from "./rock-instances";
import { createRockShape, ROCK_FAMILY, ROCK_VARIANTS, type RockFamily, type RockShape } from "./rock-shapes";
import {
  TALUS_EXPOSURE,
  TALUS_MAX_SLOPE,
  type TalusFamilyPicker,
  type TalusField,
  type TalusSpot
} from "./rock-talus";
import { getGradient, isInWater, type RockTerrain } from "./rock-terrain";
import { createTileRandom, listGridSteps, type RockTile } from "./rock-tiles";
import { groundScreeStone } from "./scree-grounding";

/**
 * Talus blocks at the mountain foot (the colliders of the talus fans, see rock-talus.ts): a few
 * large blocks right below the wall and a few that rolled out to the fan's runout, none where
 * the wall above is short or gentle. Angular families alike within a fan, the wall's tint,
 * partly buried; slabs lie flat, blocks lean against the wall.
 */
const groundedShapes = new Map<string, RockShape>();
const CANDIDATE_STEP = 0.55;
/** Expected blocks per candidate at a full fan. */
const DENSITY = 1;
/** Block width near the wall and at the runout (the biggest blocks roll the farthest). */
const NEAR_SIZE: [number, number] = [0.6, 1.3];
const RUNOUT_SIZE: [number, number] = [0.9, 1.7];
/** Blocks at least this wide stay at far zoom (outcrop role); smaller ones are rubble (LOD). */
const LARGE_SIZE = 0.9;
/** Blocks at least this wide use the 320 triangle shape. */
const HIGH_DETAIL_SIZE = 1.2;
/** Tint spread between the blocks (small: neighbours read as one rock). */
const TINT_SPREAD = 0.15;

/** Where in its fan a block lies: right below the wall, or at the runout. */
const getBlockShare = ({ run }: TalusSpot) =>
  Math.max(1 - smoothstep(0.1, 0.4, run), smoothstep(0.6, 0.8, run) * 0.4);

export interface ApronContext {
  /** Stone family of a talus spot (rock-talus.ts createTalusFamilies). */
  family: TalusFamilyPicker;
  geology: GeologyMap;
  talus: TalusField;
  terrain: RockTerrain;
  /** Whether a block of `extent` at `centre` would crowd placed rocks (and adds it if not). */
  tryReserve: (centre: Vec3, extent: Vec3) => boolean;
}

/** Size of a block along its axes by its family (slabs wide and flat). */
const getBlockDims = (family: RockFamily, size: number, random: Random): Vec3 => {
  if (family === ROCK_FAMILY.slab) {
    return [size * (1.2 + random() * 0.3), size * (0.35 + random() * 0.12), size];
  }
  return [
    size * (1 + random() * 0.3),
    size * (0.6 + random() * 0.25),
    size * (0.8 + random() * 0.25)
  ];
};

const createBlock = (
  context: ApronContext,
  random: Random,
  [x, z]: [number, number],
  spot: TalusSpot
): RockInstance => {
  const { geology, terrain } = context;
  const [low, high] = spot.run > 0.5 ? RUNOUT_SIZE : NEAR_SIZE;
  const size = (low + (high - low) * random() ** 1.4) * (0.75 + spot.amount * 0.25);
  const family = context.family(x, z, random());
  const dims = getBlockDims(family, size, random);
  const [gx, gz] = getGradient(terrain, x, z);
  const uphill: Vec3 = [-gx, 0, -gz];
  const leansOnWall = family !== ROCK_FAMILY.slab && spot.run < 0.3 && random() < 0.4;
  const lean = leansOnWall ? -0.3 : (random() - 0.5) * 0.25;
  const frame = tiltFrame(createUprightFrame(uphill), (random() - 0.5) * 0.4, lean);
  const y = terrain.height(x, z) - dims[1] * (0.25 + random() * 0.2);
  return {
    axes: scaleFrame(frame, dims),
    centre: [x, y + dims[1] * 0.5, z],
    detailed: false,
    exposure: TALUS_EXPOSURE,
    family,
    high: size >= HIGH_DETAIL_SIZE,
    moss: 0.4 * terrain.moisture(x, z),
    role: size >= LARGE_SIZE ? ROCK_ROLE.outcrop : ROCK_ROLE.rubble,
    slab: -1,
    tint: geology.tint(x, z) + (random() - 0.5) * TINT_SPREAD,
    variant: Math.floor(random() * ROCK_VARIANTS)
  };
};

/** Half extent of a placed rock along the world axes (crowding test). */
const getHalfExtent = (rock: RockInstance) =>
  rock.axes.map(
    (_, axis) => rock.axes.reduce((sum, vector) => sum + Math.abs(vector[axis]!), 0) * 0.5
  ) as unknown as Vec3;

/** Whether a block may lie at the spot: flat enough, dry, no building land. */
const isFreeGround = (terrain: RockTerrain, x: number, z: number) => {
  if (Math.hypot(...getGradient(terrain, x, z)) > TALUS_MAX_SLOPE) return false;
  return !isInWater(terrain, x, z, 1) && !terrain.isBuildLand?.(x, z);
};

/** Talus blocks of a tile's mountain feet (deterministic per seed, own random stream). */
export const placeMountainApron = (
  context: ApronContext,
  seed: number,
  tile: RockTile
): RockInstance[] => {
  const { talus, terrain } = context;
  const random = createTileRandom(seed, "mountain-apron", tile);
  const blocks: RockInstance[] = [];
  const columns = listGridSteps(tile.minX, tile.maxX, CANDIDATE_STEP);
  for (const z of listGridSteps(tile.minZ, tile.maxZ, CANDIDATE_STEP)) {
    for (const x of columns) {
      const px = x + (random() - 0.5) * CANDIDATE_STEP;
      const pz = z + (random() - 0.5) * CANDIDATE_STEP;
      const roll = random();
      if (roll > DENSITY || terrain.mountain(px, pz) <= 0.02) continue;
      const spot = talus(px, pz);
      if (roll > spot.amount * getBlockShare(spot) * DENSITY) continue;
      if (!isFreeGround(terrain, px, pz)) continue;
      const candidate = createBlock(context, random, [px, pz], spot);
      const detail = candidate.high ? "high" : "low";
      const key = `${candidate.family}:${candidate.variant}:${detail}`;
      let shape = groundedShapes.get(key);
      if (!shape) {
        shape = createRockShape(candidate.family, candidate.variant, detail);
        groundedShapes.set(key, shape);
      }
      const block = groundScreeStone(candidate, shape, terrain);
      if (block && context.tryReserve(block.centre, getHalfExtent(block))) blocks.push(block);
    }
  }
  return blocks;
};
