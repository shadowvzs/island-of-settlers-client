import { isLedgeFall } from "../../shared/world/generation/river-falls";
import { smoothstep } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import { shuffle } from "../../shared/world/rng";
import type { Waterfall } from "../../shared/world/world-data";
import type { Vec3 } from "../props/mesh-builder";
import { analyseFacePoint, CLIFF_SLOPE, type FacePoint } from "./cliff-analysis";
import {
  createGeologyMap,
  GEOLOGY,
  type Geology,
  type GeologyMap,
  isOnFracture,
  pickSlabSize,
  type TintShift
} from "./geology";
import { placeMountainApron } from "./rock-apron";
import {
  createSlopeFrame,
  createUprightFrame,
  ROCK_ROLE,
  type RockInstance,
  type RockRole,
  scaleFrame,
  tiltFrame} from "./rock-instances";
import { ROCK_FAMILY, ROCK_VARIANTS, type RockFamily } from "./rock-shapes";
import { isMountainSkin } from "./rock-skin";
import {
  createTalusFamilies,
  createTalusField,
  type TalusFamilyPicker,
  type TalusField
} from "./rock-talus";
import { getSurfaceNormal, isInWater, type RockTerrain } from "./rock-terrain";
import {
  claimForTile,
  createTileRandom,
  listGridSteps,
  listRockTiles,
  type RockTile
} from "./rock-tiles";
import { getFaceExposure } from "./rock-zones";

const CANDIDATE_SPACING = 0.42;
const HASH_CELL = 3;

/**
 * Rocks already placed, bucketed for neighbourhood queries; a `base` hash (clearings shared by
 * every tile) is tested too but never written.
 */
const createSpatialHash = (base?: SpatialHash) => {
  const cells = new Map<string, { centre: Vec3; extent: Vec3 }[]>();
  const key = (x: number, z: number) => `${Math.floor(x / HASH_CELL)},${Math.floor(z / HASH_CELL)}`;
  const add = (centre: Vec3, extent: Vec3) => {
    const bucket = cells.get(key(centre[0], centre[2])) ?? [];
    bucket.push({ centre, extent });
    cells.set(key(centre[0], centre[2]), bucket);
  };
  /**
   * True when the box (centre, half extents) scaled by `spacing` overlaps a placed rock's box:
   * spacing < 1 lets neighbours overlap (stacked plates), > 1 keeps them apart.
   */
  const isCrowded = (centre: Vec3, extent: Vec3, spacing: number) => {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const bucket = cells.get(key(centre[0] + dx * HASH_CELL, centre[2] + dz * HASH_CELL)) ?? [];
        const hit = bucket.some((other) =>
          [0, 1, 2].every(
            (axis) =>
              Math.abs(centre[axis]! - other.centre[axis]!) <
              (extent[axis]! + other.extent[axis]!) * spacing
          )
        );
        if (hit) return true;
      }
    }
    return base?.isCrowded(centre, extent, spacing) ?? false;
  };
  return { add, isCrowded };
};

interface SpatialHash {
  add: (centre: Vec3, extent: Vec3) => void;
  isCrowded: (centre: Vec3, extent: Vec3, spacing: number) => boolean;
}

interface PlacementContext {
  geology: GeologyMap;
  hash: SpatialHash;
  random: Random;
  rocks: RockInstance[];
  terrain: RockTerrain;
}

/**
 * Jittered grid of steep points of a tile (the island wide grid, so tiles never share a point),
 * shuffled later (placement order must not follow the grid).
 */
const collectFacePoints = (context: PlacementContext, tile: RockTile, minSlope: number) => {
  const { random, terrain } = context;
  const points: FacePoint[] = [];
  const rows = listGridSteps(
    Math.max(1, tile.minZ),
    Math.min(tile.maxZ, terrain.cellsZ - 1),
    CANDIDATE_SPACING,
    1
  );
  const columns = listGridSteps(
    Math.max(1, tile.minX),
    Math.min(tile.maxX, terrain.cellsX - 1),
    CANDIDATE_SPACING,
    1
  );
  for (const z of rows) {
    for (const x of columns) {
      const jx = x + (random() - 0.5) * CANDIDATE_SPACING;
      const jz = z + (random() - 0.5) * CANDIDATE_SPACING;
      if (terrain.height(jx, jz) < -0.3) continue;
      const point = analyseFacePoint(terrain, jx, jz, minSlope);
      if (point) points.push(point);
    }
  }
  return points;
};

/** One face point per stretch of lip (the columns the slabs are stacked in). */
const pickColumns = (points: FacePoint[], spacing: number) => {
  const taken = new Set<string>();
  return points.filter((point) => {
    const key = `${Math.round(point.top[0] / spacing)},${Math.round(point.top[2] / spacing)}`;
    if (taken.has(key)) return false;
    taken.add(key);
    return true;
  });
};

/** Points from the lip down to the foot of one column, about `step` world units apart. */
/**
 * Where the face reaches height `y` between the lip and the foot of a column: bisection along
 * the line from the lip to the foot (the ground falls monotonically along it).
 */
const findFacePosition = (terrain: RockTerrain, column: FacePoint, y: number): Vec3 => {
  let near = 0;
  let far = 1;
  for (let step = 0; step < 14; step += 1) {
    const middle = (near + far) / 2;
    const x = column.top[0] + (column.base[0] - column.top[0]) * middle;
    const z = column.top[2] + (column.base[2] - column.top[2]) * middle;
    if (terrain.height(x, z) > y) near = middle;
    else far = middle;
  }
  const t = (near + far) / 2;
  return [
    column.top[0] + (column.base[0] - column.top[0]) * t,
    y,
    column.top[2] + (column.base[2] - column.top[2]) * t
  ];
};

/** Points on the face from the lip down to the foot of one column, about `step` apart. */
const stackColumn = (
  terrain: RockTerrain,
  column: FacePoint,
  step: number,
  random: Random
): FacePoint[] => {
  const count = Math.max(1, Math.round(column.height / step));
  return Array.from({ length: count }, (_, index) => {
    const t = Math.min(1, (index + 0.3 + random() * 0.4) / count);
    const y = column.top[1] + (column.base[1] - column.top[1]) * t;
    return { ...column, position: findFacePosition(terrain, column, y) };
  }).filter(({ position: [x, y, z] }) => {
    // A curved column can cross another slope and lose its monotonic height bracket.
    // Reject that projection rather than suspending a slab at the requested height.
    return Math.abs(terrain.height(x, z) - y) <= 0.05;
  });
};

/**
 * Slab positions over the whole face: columns along the lip, each stacked from the lip down to
 * the foot (height field sampling alone leaves near vertical faces almost empty).
 */
const expandFaces = (context: PlacementContext, points: FacePoint[]) => {
  const columns = pickColumns(points, 0.55);
  const stacked = columns.flatMap((column) => {
    const geology = GEOLOGY[context.geology.geology(column.top[0], column.top[2])];
    const step =
      (geology.size[0][1] + geology.size[1][1]) *
      0.32 *
      (0.55 + Math.min(1, column.height / 4.5) * 0.9);
    return stackColumn(context.terrain, column, Math.max(0.25, step), context.random);
  });
  return shuffle(stacked, context.random);
};

const pickFamily = (families: RockFamily[], random: Random) =>
  families[Math.floor(random() * families.length)]!;

interface SlabRequest {
  geology: Geology;
  point: FacePoint;
  role: RockRole;
  scale: number;
  slab: number;
}

/** One slab on a face: frame by geology, tilted, embedded, sized by the face height. */
const createSlab = (context: PlacementContext, request: SlabRequest): RockInstance => {
  const { geology, random, terrain } = context;
  const { point } = request;
  const style = GEOLOGY[request.geology];
  const [x, , z] = point.position;
  const base = style.alongSlope
    ? createSlopeFrame(getSurfaceNormal(terrain, x, z))
    : createUprightFrame(point.outward);
  const roll = geology.dip(x, z) + (random() - 0.5) * 2 * style.roll;
  const frame = tiltFrame(base, roll, (random() - 0.5) * 2 * style.lean);
  const size = pickSlabSize(style, point.height, random).map(
    (value) => value * request.scale
  ) as unknown as Vec3;
  const protrude =
    (style.protrude[0] + random() * (style.protrude[1] - style.protrude[0])) * request.scale;
  const push = size[2] * 0.5 - protrude * (0.6 + Math.min(1.2, point.height / 4));
  const centre: Vec3 = [
    x - frame.z[0] * push,
    point.position[1] - frame.z[1] * push,
    z - frame.z[2] * push
  ];
  const heightOnFace = (point.position[1] - point.base[1]) / Math.max(0.2, point.height);
  return {
    axes: scaleFrame(frame, size),
    centre,
    exposure: getFaceExposure(heightOnFace, point.height) * style.exposure,
    family: pickFamily(style.families, random),
    high: request.scale > 0.7,
    moss: style.moss * (0.4 + terrain.moisture(x, z) * 0.9),
    role: request.role,
    slab: request.slab,
    tint: geology.tint(x, z) + (random() - 0.5) * 0.35,
    variant: Math.floor(random() * ROCK_VARIANTS)
  };
};

/** World axis aligned half extents of a rock. */
const getExtent = (rock: RockInstance): Vec3 =>
  [0, 1, 2].map(
    (axis) => rock.axes.reduce((sum, vector) => sum + Math.abs(vector[axis]!), 0) * 0.5
  ) as unknown as Vec3;

/** Places a slab unless the spot is crowded; returns it when placed. */
const tryPlace = (context: PlacementContext, request: SlabRequest, spacing: number) => {
  const rock = createSlab(context, request);
  const extent = getExtent(rock);
  if (isInWater(context.terrain, rock.centre[0], rock.centre[2], extent[0] + extent[2]))
    return null;
  if (context.hash.isCrowded(rock.centre, extent, spacing)) return null;
  context.hash.add(rock.centre, extent);
  context.rocks.push(rock);
  return rock;
};

/**
 * Macro pass (the big forms): large slabs, spaced so they overlap a little like stacked plates;
 * none on the major fracture lines, which stay open as deep gaps.
 */
const placeMacroSlabs = (context: PlacementContext, points: FacePoint[]) => {
  const placed: FacePoint[] = [];
  for (const point of points) {
    const [x, , z] = point.position;
    if (isMountainSkin(context.terrain, x, z)) {
      placed.push(point);
      continue;
    }
    if (isOnFracture(context.geology, x, z)) continue;
    const geology = context.geology.geology(x, z);
    const request = { geology, point, role: ROCK_ROLE.slab, scale: 1, slab: context.rocks.length };
    if (tryPlace(context, request, 0.5)) placed.push(point);
  }
  return placed;
};

/** Meso pass: smaller plates fill what the slabs left open (fractures stay narrower but open). */
const placeMesoPlates = (context: PlacementContext, points: FacePoint[]) => {
  for (const point of points) {
    const [x, , z] = point.position;
    if (isMountainSkin(context.terrain, x, z)) continue;
    const geology = context.geology.geology(x, z);
    const scale = isOnFracture(context.geology, x, z) ? 0.3 : 0.5;
    tryPlace(context, { geology, point, role: ROCK_ROLE.plate, scale, slab: -1 }, 0.6);
  }
};

/** Ground rock size above which the 320 triangle shape is used (else 80). */
const GROUND_ROCK_HIGH_SIZE = 0.75;

/** A small rock lying on the ground: broken or blocky, mostly upright, partly buried. */
const createGroundRock = (
  context: PlacementContext,
  position: Vec3,
  size: number,
  role: RockRole,
  flat: boolean
): RockInstance => {
  const { random, terrain } = context;
  const yaw = random() * Math.PI * 2;
  const upright = createUprightFrame([Math.cos(yaw), 0, Math.sin(yaw)]);
  const frame = tiltFrame(upright, (random() - 0.5) * 0.35, (random() - 0.5) * 0.35);
  const dims: Vec3 = flat ? [size * 1.6, size * 0.45, size * 1.2] : [size * 1.2, size * 0.85, size];
  const y = terrain.height(position[0], position[2]) - dims[1] * (0.18 + random() * 0.15);
  return {
    axes: scaleFrame(frame, dims),
    centre: [position[0], y, position[2]],
    exposure: 0,
    family: flat
      ? ROCK_FAMILY.slab
      : pickFamily([ROCK_FAMILY.broken, ROCK_FAMILY.blocky, ROCK_FAMILY.weathered], random),
    /** Lip stones and rubble are small at gameplay distance: high detail only for big ones. */
    high: size > GROUND_ROCK_HIGH_SIZE,
    moss: 0.5 * terrain.moisture(position[0], position[2]),
    role,
    slab: -1,
    tint: context.geology.tint(position[0], position[2]) + (random() - 0.5) * 0.5,
    variant: Math.floor(random() * ROCK_VARIANTS)
  };
};

/**
 * Rubble at the foot: more under tall faces and under fractures, in a fan out from the face,
 * bigger pieces near the wall, gravel further out.
 */
const placeRubble = (context: PlacementContext, faces: FacePoint[]) => {
  const { random } = context;
  for (const face of faces) {
    /** Mountain feet get the boulder apron instead (no rubble left on the face). */
    if (isMountainSkin(context.terrain, face.base[0], face.base[2])) continue;
    const fracture = isOnFracture(context.geology, face.position[0], face.position[2]) ? 2 : 1;
    const count = Math.floor(smoothstep(0.8, 6, face.height) * 1.6 * fracture * random());
    for (let index = 0; index < count; index += 1) {
      const out = random() * (0.3 + face.height * 0.35);
      const side = (random() - 0.5) * 1.6;
      const across: Vec3 = [-face.outward[2], 0, face.outward[0]];
      const position: Vec3 = [
        face.base[0] + face.outward[0] * out + across[0] * side,
        0,
        face.base[2] + face.outward[2] * out + across[2] * side
      ];
      const size =
        (0.12 + random() * 0.28) *
        (1.25 - out / (0.3 + face.height * 0.35)) *
        Math.min(1.5, 0.6 + face.height * 0.15);
      const rock = createGroundRock(context, position, size, ROCK_ROLE.rubble, false);
      const extent = getExtent(rock);
      if (isInWater(context.terrain, rock.centre[0], rock.centre[2], extent[0] + extent[2]))
        continue;
      if (context.hash.isCrowded(rock.centre, extent, 0.9)) continue;
      context.hash.add(rock.centre, extent);
      context.rocks.push(rock);
    }
  }
};

/** Broken lip: flat stones along the top edge, partly sunk into the plateau soil. */
const placeLip = (context: PlacementContext, faces: FacePoint[]) => {
  const { random } = context;
  for (const face of faces) {
    if (random() > 0.25 || face.height < 0.6) continue;
    /** Mountain crests carry only the builder's few summit stones (no stray lip stones). */
    if (isMountainSkin(context.terrain, face.top[0], face.top[2])) continue;
    const back = random() * 0.5;
    const position: Vec3 = [
      face.top[0] - face.outward[0] * back,
      0,
      face.top[2] - face.outward[2] * back
    ];
    const size = 0.25 + random() * 0.35;
    const rock = createGroundRock(context, position, size, ROCK_ROLE.lip, random() < 0.7);
    const extent = getExtent(rock);
    if (isInWater(context.terrain, rock.centre[0], rock.centre[2], extent[0] + extent[2])) continue;
    if (context.hash.isCrowded(rock.centre, extent, 0.8)) continue;
    context.hash.add(rock.centre, extent);
    context.rocks.push(rock);
  }
};

/** Sill boulders of a cascade ledge: their highest point stays this far under the upper water. */
const SILL_UNDER_WATER = 0.08;
const SILL_SPACING = 0.9;

/** Places a ground rock unless the spot is crowded (stones in water allowed: ledge stones). */
const tryPlaceStone = (context: PlacementContext, rock: RockInstance, spacing: number) => {
  const extent = getExtent(rock);
  if (context.hash.isCrowded(rock.centre, extent, spacing)) return;
  context.hash.add(rock.centre, extent);
  context.rocks.push(rock);
};

/**
 * Ledge stones of one cascade step: a row of boulders forming the sill the water spills over
 * (tops just under the upper water, feet in the bed) and a stone on each bank at the lip's ends.
 */
const placeLedgeStones = (context: PlacementContext, fall: Waterfall) => {
  const { random } = context;
  const sideX = -fall.directionZ;
  const sideZ = fall.directionX;
  const at = (across: number, along: number): Vec3 =>
    [fall.x + sideX * across + fall.directionX * along, 0, fall.z + sideZ * across + fall.directionZ * along];
  const sills = Math.max(1, Math.round(fall.width / SILL_SPACING));
  for (let index = 0; index < sills; index += 1) {
    const across = ((index + 0.5) / sills - 0.5) * fall.width + (random() - 0.5) * 0.2;
    const size = 0.5 + random() * 0.2;
    const rock = createGroundRock(context, at(across, 0.1), size, ROCK_ROLE.lip, false);
    const [x, , z] = rock.centre;
    tryPlaceStone(context, { ...rock, centre: [x, fall.top - SILL_UNDER_WATER - getExtent(rock)[1], z] }, 0.5);
  }
  for (const side of [-1, 1]) {
    const size = 0.3 + random() * 0.2;
    const across = side * (fall.width / 2 + size * 0.45);
    tryPlaceStone(context, createGroundRock(context, at(across, random() * 0.3), size, ROCK_ROLE.lip, false), 0.8);
  }
};

/** Ledge stones of the cascade steps whose lip lies in the tile ("fall lip" rule). */
const placeFallLips = (context: PlacementContext, tile: RockTile) => {
  for (const fall of context.terrain.waterfalls ?? []) {
    if (!isLedgeFall(fall)) continue;
    if (fall.x < tile.minX || fall.x >= tile.maxX || fall.z < tile.minZ || fall.z >= tile.maxZ) continue;
    placeLedgeStones(context, fall);
  }
};

export interface RockPlacementOptions {
  /** Force one geology everywhere (lab-cliff test terrain); island: regional. */
  geology?: Geology;
  /** Ground points no rock may cover (island tree trunks). */
  keepClear?: Vec3[];
  seed: number;
  /** Stone tint shift of the local island theme (none = default stone colours). */
  tintShift?: TintShift;
}

/** Half width and half height of the space kept free around a tree trunk. */
const TRUNK_CLEARANCE: Vec3 = [0.7, 2, 0.7];

/** Reserves the space around each point, so rock placement skips anything crowding it. */
const reserveClearings = (points: Vec3[]) => {
  const hash = createSpatialHash();
  for (const [x, y, z] of points) {
    hash.add([x, y + TRUNK_CLEARANCE[1], z], TRUNK_CLEARANCE);
  }
  return hash;
};

/**
 * What every tile's placement shares: the terrain, its geology and talus, the seed and the
 * clearings.
 */
interface PlacementGround {
  clearings: SpatialHash;
  /** Talus stone family per spot (rock-talus.ts). */
  family: TalusFamilyPicker;
  geology: GeologyMap;
  seed: number;
  talus: TalusField;
  terrain: RockTerrain;
}

/** The talus blocks of a tile's mountain feet, crowd tested against the tile's rocks. */
const placeTileApron = (context: PlacementContext, ground: PlacementGround, tile: RockTile) => {
  const { hash } = context;
  const { family, geology, seed, talus, terrain } = ground;
  const tryReserve = (centre: Vec3, extent: Vec3) => {
    if (hash.isCrowded(centre, extent, 0.85)) return false;
    hash.add(centre, extent);
    return true;
  };
  return placeMountainApron({ family, geology, talus, terrain, tryReserve }, seed, tile);
};

/** Every rock a tile places (its own random stream and crowding test). */
const placeTileRocks = (ground: PlacementGround, tile: RockTile) => {
  const { clearings, geology, seed, terrain } = ground;
  const context: PlacementContext = {
    geology,
    hash: createSpatialHash(clearings),
    random: createTileRandom(seed, "rocks", tile),
    rocks: [],
    terrain
  };
  const points = expandFaces(context, collectFacePoints(context, tile, CLIFF_SLOPE));
  const faces = placeMacroSlabs(context, points);
  placeMesoPlates(context, points);
  placeLip(context, faces);
  placeRubble(context, faces);
  context.rocks.push(...placeTileApron(context, ground, tile));
  placeFallLips({ ...context, random: createTileRandom(seed, "fall-lips", tile) }, tile);
  return claimForTile(context.rocks, tile);
};

/**
 * The rock layer of a terrain: macro slabs and meso plates on every steep face, a broken lip
 * along the top edges, rubble at the feet, talus blocks below tall mountain walls. Placed tile by
 * tile (see rock-tiles.ts): deterministic per seed and terrain, also when only the tiles of the
 * terrain's area are placed (map editor).
 */
export const placeRocks = (terrain: RockTerrain, options: RockPlacementOptions) => {
  const geology = createGeologyMap(terrain, options.seed, {
    forced: options.geology,
    tintShift: options.tintShift
  });
  const { seed } = options;
  const ground: PlacementGround = {
    clearings: reserveClearings(options.keepClear ?? []),
    family: createTalusFamilies(seed),
    geology,
    seed,
    talus: createTalusField(terrain, geology, seed),
    terrain
  };
  return listRockTiles(terrain).flatMap((tile) => placeTileRocks(ground, tile));
};
