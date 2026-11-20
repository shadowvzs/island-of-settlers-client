import { createCellRandom, deriveSeed, type Random } from "../../shared/world/rng";
import { PROP, type WorldData } from "../../shared/world/world-data";
import type { Vec3 } from "../props/mesh-builder";
import {
  createUprightFrame,
  ROCK_ROLE,
  type RockInstance,
  scaleFrame,
  tiltFrame} from "./rock-instances";
import { createRockShape, ROCK_FAMILY, ROCK_VARIANTS, type RockShape } from "./rock-shapes";
import { getGradient, type RockTerrain } from "./rock-terrain";

/**
 * Standalone meadow stones (props smallRock / largeRock, editor pebble patches), drawn by the
 * rock layer with the shared rock material and its close-up detail octave. Shapes follow the
 * stone references: low, broad, wide-based boulders and flattened wedges, partly buried, one
 * bigger stone with smaller ones around it. The props stay in the world (nav colliders, the dirt / pebble rim of
 * the ground chain); their prop meshes are empty.
 */
const FAMILIES = [ROCK_FAMILY.weathered, ROCK_FAMILY.blocky, ROCK_FAMILY.weathered];
/** Base radius (world units at prop scale 1) and companion stones per kind. */
const STONE_KINDS: Record<number, { companions: number; radius: number }> = {
  [PROP.smallRock]: { companions: 2, radius: 0.3 },
  [PROP.largeRock]: { companions: 3, radius: 0.55 },
  [PROP.pebbles]: { companions: 6, radius: 0.11 }
};
/** Share of a stone's height sunk into the soil. */
const BURIAL: [number, number] = [0.25, 0.4];
const HIGH_DETAIL_WIDTH = 1;
const contactShapes = new Map<string, RockShape>();

/** Preserve the footprint/collider and fit the actual lower shell against sloping soil. */
const bedStone = (stone: RockInstance, terrain: RockTerrain) => {
  const detail = stone.high ? "high" : "low";
  const key = `${stone.family}/${stone.variant}/${detail}`;
  let shape = contactShapes.get(key);
  if (!shape) {
    shape = createRockShape(stone.family, stone.variant, detail);
    contactShapes.set(key, shape);
  }
  let y = stone.centre[1];
  const margin = Math.hypot(...stone.axes[1]) * .035;
  for (let i = 0; i < shape.positions.length; i += 3) {
    if (shape.positions[i + 1]! > -.15) continue;
    const point = shape.positions.subarray(i, i + 3);
    const offset = [0, 1, 2].map(axis => stone.axes[0][axis]! * point[0]! +
      stone.axes[1][axis]! * point[1]! + stone.axes[2][axis]! * point[2]!);
    const ground = terrain.height(stone.centre[0] + offset[0]!, stone.centre[2] + offset[2]!);
    y = Math.min(y, ground - offset[1]! - margin);
  }
  return { ...stone, centre: [stone.centre[0], y, stone.centre[2]] as Vec3 };
};

export interface StoneRequest {
  centre: [number, number];
  radius: number;
  yaw: number;
}

/** One standalone boulder (detailed stone): broad, low, partly buried. */
export const createStone = (
  terrain: RockTerrain,
  tint: (x: number, z: number) => number,
  random: Random,
  { centre: [x, z], radius, yaw }: StoneRequest
): RockInstance => {
  const dims: Vec3 = [
    radius * (2.2 + random() * 0.6),
    radius * (0.75 + random() * 0.35),
    radius * (1.7 + random() * 0.5)
  ];
  const upright = createUprightFrame([Math.cos(yaw), 0, Math.sin(yaw)]);
  const frame = tiltFrame(upright, (random() - 0.5) * 0.25, (random() - 0.5) * 0.25);
  const burial = BURIAL[0] + random() * (BURIAL[1] - BURIAL[0]);
  return bedStone({
    axes: scaleFrame(frame, dims),
    centre: [x, terrain.height(x, z) + dims[1] * (0.5 - burial), z],
    detailed: true,
    exposure: 0.15,
    family: FAMILIES[Math.floor(random() * FAMILIES.length)]!,
    high: dims[0] >= HIGH_DETAIL_WIDTH,
    moss: 0.3 + 0.5 * terrain.moisture(x, z),
    role: ROCK_ROLE.outcrop,
    slab: -1,
    tint: tint(x, z) * 0.6 + 0.25,
    variant: Math.floor(random() * ROCK_VARIANTS)
  }, terrain);
};

/** Steep mountain ground: rock props there are not drawn (no stones perched on the face). */
const isOnSteepMountain = (terrain: RockTerrain, x: number, z: number) =>
  terrain.mountain(x, z) > 0.1 && Math.hypot(...getGradient(terrain, x, z)) > 0.8;

/** Where a meadow rock prop stands: its position, scale and yaw. */
export interface StonePlace {
  scale: number;
  x: number;
  yaw: number;
  z: number;
}

/** The stones of one meadow rock prop: a main stone with its smaller companions around it. */
export const createPropStones = (
  kind: number,
  place: StonePlace,
  ground: { random: Random; terrain: RockTerrain; tint: (x: number, z: number) => number }
) => {
  const { companions, radius: base } = STONE_KINDS[kind]!;
  const { random, terrain, tint } = ground;
  const { scale, x, yaw, z } = place;
  const radius = base * scale;
  const stones = [createStone(terrain, tint, random, { centre: [x, z], radius, yaw })];
  for (let companion = 0; companion < companions; companion += 1) {
    const angle = yaw + (companion / companions) * Math.PI * 2 + random() * 0.8;
    const reach = radius * (1.3 + random() * 0.5);
    const centre: [number, number] = [x + Math.cos(angle) * reach, z + Math.sin(angle) * reach];
    const request = { centre, radius: radius * (0.35 + random() * 0.25), yaw: random() * 6.3 };
    stones.push(createStone(terrain, tint, random, request));
  }
  // Companions can cross a nearby cliff although the original prop lies on level ground.
  return stones.filter(stone => !isOnSteepMountain(terrain, stone.centre[0], stone.centre[2]));
};

/**
 * The stones of every meadow rock prop (deterministic per world: each prop has its own random
 * stream, so a rebuild of some chunks keeps the other stones). `keep`: only stones whose centre
 * passes (map editor chunk rebuilds).
 */
export const createMeadowStones = (
  world: WorldData,
  terrain: RockTerrain,
  tint: (x: number, z: number) => number,
  keep: (x: number, z: number) => boolean = () => true
): RockInstance[] => {
  const seed = deriveSeed(world.seed, "meadow-stones");
  // These existing prop identities retain collision/depletion; the finite material layer draws their shells.
  const materialProps = new Set((world.scenario?.marbleDeposits ?? world.colonyStoneDeposits ?? [])
    .flatMap(deposit => deposit.sourceProp === undefined ? [] : [deposit.sourceProp]));
  const stones: RockInstance[] = [];
  for (let index = 0; index < world.props.count; index += 1) {
    if (materialProps.has(index)) continue;
    stones.push(...createPropStonesOf(world, { seed, terrain, tint }, index));
  }
  return stones.filter(({ centre }) => keep(centre[0], centre[2]));
};

interface MeadowStoneGround {
  seed: number;
  terrain: RockTerrain;
  tint: (x: number, z: number) => number;
}

/** The stones one rock prop draws (none for other kinds or on steep mountain ground). */
const createPropStonesOf = (world: WorldData, { seed, terrain, tint }: MeadowStoneGround, index: number) => {
  const { props } = world;
  const kind = props.types[index]!;
  const [x, z] = [props.x[index]!, props.z[index]!];
  if (!STONE_KINDS[kind] || isOnSteepMountain(terrain, x, z)) return [];
  const random = createCellRandom(seed, index);
  const place = { scale: props.scale[index]!, x, yaw: props.rotation[index]!, z };
  return createPropStones(kind, place, { random, terrain, tint });
};

/** The very stones the meadow layer draws for one rock prop (a respawning boulder grows in as them). */
export const createMeadowPropStones = (
  world: WorldData,
  terrain: RockTerrain,
  tint: (x: number, z: number) => number,
  index: number
) => createPropStonesOf(world, { seed: deriveSeed(world.seed, "meadow-stones"), terrain, tint }, index);
