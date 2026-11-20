import { smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import { pickFrom } from "../../shared/world/rng";
import type { Vec3 } from "../props/mesh-builder";
import type { GeologyMap } from "./geology";
import {
  createUprightFrame,
  ROCK_ROLE,
  type RockInstance,
  type RockRole,
  scaleFrame,
  tiltFrame} from "./rock-instances";
import {
  createRockShape,
  ROCK_FAMILY,
  ROCK_VARIANTS,
  type RockFamily,
  type RockLibrary,
  type RockShape
} from "./rock-shapes";
import {
  createTalusFamilies,
  createTalusField,
  TALUS_EXPOSURE,
  type TalusFamilyPicker,
  type TalusField,
  type TalusSpot
} from "./rock-talus";
import { getGradient, isInWater, type RockTerrain } from "./rock-terrain";
import {
  claimForTile,
  createTileRandom,
  listGridSteps,
  listRockTiles,
  type RockTile
} from "./rock-tiles";
import { groundScreeStone } from "./scree-grounding";

/**
 * Mountain builder: accents on the sculpted skin, which carries the mountain body itself (one
 * smooth, continuous rock). Steep faces and mid slopes stay free of stones (owner: stones
 * perched on the face read as strays). The builder only adds:
 * - a few summit stones: well bedded (about 40 % sunk), wall coloured, on crests and peaks,
 *   spaced irregularly (never a row);
 * - scree: small stones of the talus fans below tall walls (render only, dropped by the
 *   distance LOD).
 * All render only, never in river beds or plunge pools, shaded by the shared rock material.
 */
export interface MountainBuilderOptions {
  /** Size multiplier of the stones (1 = default). */
  blockScale: number;
  /** Spots kept free of render-only stones (island: tree trunks). */
  isKeptClear?: (x: number, z: number) => boolean;
  seed: number;
  /** 0 bare summits .. 1 a stone on most crest spots. */
  summit: number;
}

export const DEFAULT_MOUNTAIN_BUILDER: Omit<MountainBuilderOptions, "seed"> = {
  blockScale: 1,
  summit: 0.25
};

/** Crest candidate spacing (world units) and how much of a summit stone is buried. */
const SUMMIT_SPACING = 5;
const SUMMIT_BURIAL = 0.58;
const SUMMIT_SIZE: [number, number] = [0.8, 1.5];
/** Ground flatter than this counts as a summit top (stones never sit on the steep face). */
const SUMMIT_MAX_SLOPE = 0.6;
/** Snow fillets only where the rock carries snow (the shader's snow line is about 7.5). */
const SNOW_FILLET_HEIGHT = 7.3;

interface BuildContext {
  /** Talus stone family per spot (rock-talus.ts). */
  family: TalusFamilyPicker;
  geology: GeologyMap;
  masses: RockInstance[];
  options: MountainBuilderOptions;
  random: Random;
  shape: (stone: RockInstance) => RockShape;
  talus: TalusField;
  terrain: RockTerrain;
}

interface AccentStyle {
  families: RockFamily[];
  role: RockRole;
}

const FILLET: AccentStyle = { families: [ROCK_FAMILY.weathered], role: ROCK_ROLE.mass };
const SUMMIT: AccentStyle = {
  families: [ROCK_FAMILY.weathered, ROCK_FAMILY.blocky],
  role: ROCK_ROLE.mass
};


/** A stone in the rock layer: the wall's tint and exposure, so it reads as the same rock. */
const createAccent = (
  context: BuildContext,
  centre: Vec3,
  dims: Vec3,
  style: AccentStyle
): RockInstance => {
  const { random, terrain } = context;
  const yaw = random() * Math.PI * 2;
  const frame = tiltFrame(createUprightFrame([Math.cos(yaw), 0, Math.sin(yaw)]), 0.15, 0.15);
  const altitude = smoothstep(0.2, 0.9, terrain.mountain(centre[0], centre[2]));
  return {
    axes: scaleFrame(frame, dims),
    centre,
    exposure: 0.35 + altitude * 0.65,
    family: pickFrom(random, style.families),
    high: false,
    moss: 0.2 * terrain.moisture(centre[0], centre[2]),
    role: style.role,
    slab: -1,
    tint: context.geology.tint(centre[0], centre[2]),
    variant: Math.floor(random() * ROCK_VARIANTS)
  };
};

/** Crests and peaks: the highest point around (a ridge line or a summit) with a flat top. */
const isSummit = (terrain: RockTerrain, x: number, z: number) => {
  if (terrain.mountain(x, z) < 0.4) return false;
  if (Math.hypot(...getGradient(terrain, x, z)) > SUMMIT_MAX_SLOPE) return false;
  const height = terrain.height(x, z);
  const higher = [0, 1, 2, 3, 4, 5].filter((step) => {
    const angle = (step / 6) * Math.PI * 2;
    return terrain.height(x + Math.cos(angle) * 1.6, z + Math.sin(angle) * 1.6) > height + 0.05;
  }).length;
  return higher <= 1;
};

/**
 * A low, wide, smooth mound around a summit stone's base: under snow its upward faces take the
 * snow cap, so the snow flows up onto the stone (rock poking through snow, not placed on it).
 */
const createSnowFillet = (context: BuildContext, [x, , z]: Vec3, dims: Vec3) => {
  const { terrain } = context;
  const fillet: Vec3 = [dims[0] * 1.7, dims[1] * 0.45, dims[2] * 1.7];
  const centre: Vec3 = [x, terrain.height(x, z) - fillet[1] * 0.15, z];
  return { ...createAccent(context, centre, fillet, FILLET), exposure: 0 };
};

/** A few well bedded stones on summits and crests (jittered, never a regular row). */
const placeSummitStones = (context: BuildContext, tile: RockTile) => {
  const { options, random, terrain } = context;
  const spacing = SUMMIT_SPACING * options.blockScale;
  const columns = listGridSteps(tile.minX, tile.maxX, spacing);
  for (const z of listGridSteps(tile.minZ, tile.maxZ, spacing)) {
    for (const x of columns) {
      const px = x + (random() - 0.5) * spacing * 0.8;
      const pz = z + (random() - 0.5) * spacing * 0.8;
      if (random() > options.summit || !isSummit(terrain, px, pz)) continue;
      if (isInWater(terrain, px, pz, 2)) continue;
      const width =
        (SUMMIT_SIZE[0] + random() * (SUMMIT_SIZE[1] - SUMMIT_SIZE[0])) * options.blockScale;
      const dims: Vec3 = [width, width * (0.55 + random() * 0.2), width * (0.75 + random() * 0.2)];
      const centre: Vec3 = [px, terrain.height(px, pz) + dims[1] * (0.5 - SUMMIT_BURIAL), pz];
      context.masses.push(createAccent(context, centre, dims, SUMMIT));
      if (centre[1] > SNOW_FILLET_HEIGHT)
        context.masses.push(createSnowFillet(context, centre, dims));
    }
  }
};

/** Scree stones: candidate step, density at a full fan and size range (render only). */
const SCREE_STEP = 0.22;
const SCREE_DENSITY = 0.6;
const SCREE_SIZE: [number, number] = [0.22, 0.6];
/** Tint spread between the stones (small: neighbours read as one rock). */
const SCREE_TINT_SPREAD = 0.2;
/** Stones at least this wide keep their planes (80 triangle shape, rubble), smaller are pebbles. */
const SCREE_BLOCK_SIZE = 0.45;

/** Scree share along a fan: most stones in its upper and middle part, thinning to the runout. */
const getScreeShare = ({ run }: TalusSpot) => 1 - smoothstep(0.35, 1, run) * 0.8;

/**
 * A stone lying in the scree: the fan's family, random yaw and tilt, half buried, the wall's
 * tone; bigger towards the runout (coarse pieces roll farther).
 */
const createScreeStone = (
  context: BuildContext,
  [x, z]: [number, number],
  spot: TalusSpot,
  family: RockFamily
) => {
  const { options, random, terrain } = context;
  const grade = 0.75 + spot.run * 0.4;
  const size =
    (SCREE_SIZE[0] + (SCREE_SIZE[1] - SCREE_SIZE[0]) * random() ** 1.5) *
    grade *
    options.blockScale;
  const flat = family === ROCK_FAMILY.slab;
  const dims: Vec3 = [
    size * (1 + random() * 0.4),
    size * (flat ? 0.35 + random() * 0.12 : 0.55 + random() * 0.3),
    size * (0.75 + random() * 0.3)
  ];
  const yaw = random() * Math.PI * 2;
  const tilt = (random() - 0.5) * 0.5;
  const frame = tiltFrame(createUprightFrame([Math.cos(yaw), 0, Math.sin(yaw)]), tilt, tilt * 0.6);
  const stone = createAccent(
    context,
    [x, terrain.height(x, z) + dims[1] * (0.05 + random() * 0.15), z],
    dims,
    { families: [family], role: size >= SCREE_BLOCK_SIZE ? ROCK_ROLE.rubble : ROCK_ROLE.pebble }
  );
  return {
    ...stone,
    axes: scaleFrame(frame, dims),
    detailed: false,
    exposure: TALUS_EXPOSURE,
    tint: stone.tint + (random() - 0.5) * SCREE_TINT_SPREAD
  };
};

/**
 * Scree of the talus fans (rock-talus.ts): many small stones below the tall walls' chutes and
 * rockfall cones, thinning out to the runout, none below short or gentle rock. Render only: no
 * nav colliders (the talus blocks are), dropped by the distance LOD (pebble role).
 */
const placeScree = (context: BuildContext, tile: RockTile) => {
  const { family, random, talus, terrain } = context;
  const columns = listGridSteps(tile.minX, tile.maxX, SCREE_STEP);
  for (const z of listGridSteps(tile.minZ, tile.maxZ, SCREE_STEP)) {
    for (const x of columns) {
      const px = x + (random() - 0.5) * SCREE_STEP;
      const pz = z + (random() - 0.5) * SCREE_STEP;
      const roll = random();
      if (roll > SCREE_DENSITY || terrain.mountain(px, pz) <= 0.02) continue;
      const spot = talus(px, pz);
      if (roll > spot.amount * getScreeShare(spot) * SCREE_DENSITY) continue;
      if (isInWater(terrain, px, pz, 0.3) || terrain.isBuildLand?.(px, pz)) continue;
      if (context.options.isKeptClear?.(px, pz)) continue;
      const stone = createScreeStone(context, [px, pz], spot, family(px, pz, random()));
      const grounded = groundScreeStone(
        stone,
        context.shape(stone),
        terrain,
        context.options.isKeptClear
      );
      if (grounded) context.masses.push(grounded);
    }
  }
};

/** What every tile's accents share: the terrain, its geology and talus, the options. */
type BuildGround = Pick<
  BuildContext,
  "family" | "geology" | "options" | "shape" | "talus" | "terrain"
>;

/** Reuse the renderer library; isolated placement callers cache only the few needed shapes. */
const createScreeShapePicker = (library?: RockLibrary) => {
  const cached = new Map<string, RockShape>();
  return (stone: RockInstance) => {
    const detail = stone.role === ROCK_ROLE.pebble ? "pebble" : "low";
    if (library) return library[stone.family]![stone.variant]![detail];
    const key = `${stone.family}:${stone.variant}:${detail}`;
    const known = cached.get(key);
    if (known) return known;
    const shape = createRockShape(stone.family, stone.variant, detail);
    cached.set(key, shape);
    return shape;
  };
};

/** The accents of one tile (its own random stream, see rock-tiles.ts). */
const buildTileMasses = (ground: BuildGround, tile: RockTile) => {
  const context: BuildContext = {
    ...ground,
    masses: [],
    random: createTileRandom(ground.options.seed, "mountain-builder", tile)
  };
  placeSummitStones(context, tile);
  placeScree(context, tile);
  return claimForTile(context.masses, tile);
};

/**
 * Builds the rock accents of every mountain on the terrain (of the tiles in its area),
 * deterministic per seed and terrain.
 */
export const buildMountainMasses = (
  terrain: RockTerrain,
  geology: GeologyMap,
  options: MountainBuilderOptions,
  library?: RockLibrary
): RockInstance[] => {
  const ground: BuildGround = {
    family: createTalusFamilies(options.seed),
    geology,
    options,
    shape: createScreeShapePicker(library),
    talus: createTalusField(terrain, geology, options.seed),
    terrain
  };
  return listRockTiles(terrain).flatMap((tile) => buildTileMasses(ground, tile));
};
