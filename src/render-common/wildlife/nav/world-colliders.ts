import { DMath } from "../../../shared/math/deterministic-math";
import { PROP, type WorldData } from "../../../shared/world/world-data";
import {
  getTreeInstanceScale,
  getTreeSpecies,
  getTreeVariant,
  getVariantStage
} from "../../props/island-trees";
import type { RockInstance } from "../../rocks/rock-instances";
import { SPECIES, SPECIES_PROFILES } from "../wildlife-species";
import { getCrownProfile, getCrownRadius } from "./crown-profile";
import {
  ALL_SPECIES_MASK,
  COLLIDER_KIND,
  type ColliderInput,
  type ColliderKind
} from "./nav-colliders";

/** Trunk base radius (world units, root flare included) of a young / established / mature tree. */
const TRUNK_RADIUS = {
  oak: [0.065, 0.1, 0.145],
  palm: [0.05, 0.062, 0.07],
  pine: [0.05, 0.078, 0.11],
  birch: [0.036, 0.056, 0.079]
} as const;
const TRUNK_MARGIN = 0.02;
/** Rabbits slip under shrubs; deer and elk walk around them. */
const LARGE_ANIMALS_MASK = (1 << SPECIES.deer) | (1 << SPECIES.elk);

/** Solid core of the blocking world props at scale 1 (the foliage outside it does not block). */
const PROP_CORES: Partial<Record<number, { kind: ColliderKind; mask: number; radius: number }>> = {
  [PROP.bush]: { kind: COLLIDER_KIND.shrub, mask: LARGE_ANIMALS_MASK, radius: 0.27 },
  [PROP.berryBush]: { kind: COLLIDER_KIND.shrub, mask: LARGE_ANIMALS_MASK, radius: 0.25 },
  [PROP.riverShrub]: { kind: COLLIDER_KIND.shrub, mask: LARGE_ANIMALS_MASK, radius: 0.28 },
  [PROP.willowShrub]: { kind: COLLIDER_KIND.shrub, mask: LARGE_ANIMALS_MASK, radius: 0.2 },
  [PROP.fieldShrub]: { kind: COLLIDER_KIND.shrub, mask: LARGE_ANIMALS_MASK, radius: 0.18 },
  [PROP.sapling]: { kind: COLLIDER_KIND.trunk, mask: LARGE_ANIMALS_MASK, radius: 0.06 },
  [PROP.smallRock]: { kind: COLLIDER_KIND.rock, mask: ALL_SPECIES_MASK, radius: 0.2 },
  [PROP.largeRock]: { kind: COLLIDER_KIND.rock, mask: ALL_SPECIES_MASK, radius: 0.6 }
};
/** Rock pieces narrower than this are gravel: every animal steps over them. */
const MIN_ROCK_RADIUS = 0.07;
const MAX_ROCK_CIRCLES = 3;
const ROCK_COLLIDER = { kind: COLLIDER_KIND.rock, mask: ALL_SPECIES_MASK } as const;

/** Kind, placement scale and mesh variant (age and structural form) of a world tree. */
const getTreeIdentity = (world: WorldData, index: number) => {
  const kind = world.props.types[index]!;
  const scale = world.props.scale[index]!;
  return { kind, scale, variant: getTreeVariant(kind, scale, world.props.form[index]!) };
};

const getTrunkCollider = (world: WorldData, index: number): ColliderInput | null => {
  const species = getTreeSpecies(world.props.types[index]!);
  if (!species) return null;
  const { kind, scale, variant } = getTreeIdentity(world, index);
  const age = getVariantStage(kind, variant) - 3;
  const radius = TRUNK_RADIUS[species][age]! * getTreeInstanceScale(kind, scale, variant);
  return {
    kind: COLLIDER_KIND.trunk,
    mask: ALL_SPECIES_MASK,
    radius: radius + TRUNK_MARGIN,
    x: world.props.x[index]!,
    z: world.props.z[index]!
  };
};

/** Trunks of every tree and the solid cores of blocking shrubs and stones. */
/** Per species crown rings of a tree that reach further than its trunk collider. */
const addCrownColliders = (
  colliders: ColliderInput[],
  world: WorldData,
  index: number,
  trunk: ColliderInput
) => {
  const { kind, scale, variant } = getTreeIdentity(world, index);
  const profile = getCrownProfile(kind, variant);
  if (!profile) return;
  const size = getTreeInstanceScale(kind, scale, variant);
  SPECIES_PROFILES.forEach((species, id) => {
    const radius = getCrownRadius(profile, species.body.height / size) * size;
    if (radius <= trunk.radius) return;
    colliders.push({ ...trunk, kind: COLLIDER_KIND.crown, mask: 1 << id, radius });
  });
};

const collectPropColliders = (world: WorldData) => {
  const colliders: ColliderInput[] = [];
  const { props } = world;
  for (let index = 0; index < props.count; index += 1) {
    const trunk = getTrunkCollider(world, index);
    if (trunk) {
      colliders.push(trunk);
      addCrownColliders(colliders, world, index, trunk);
      continue;
    }
    const core = PROP_CORES[props.types[index]!];
    if (!core) continue;
    colliders.push({
      ...core,
      radius: core.radius * props.scale[index]!,
      x: props.x[index]!,
      z: props.z[index]!
    });
  }
  return colliders;
};

/**
 * Ground footprint of a rock: its three scaled axes projected onto the ground span an ellipse
 * (covariance of the half axes); returns the semi axes and the major direction.
 */
const getRockFootprint = (rock: RockInstance) => {
  let xx = 0;
  let xz = 0;
  let zz = 0;
  for (const axis of rock.axes) {
    xx += axis[0] * axis[0] * 0.25;
    xz += axis[0] * axis[2] * 0.25;
    zz += axis[2] * axis[2] * 0.25;
  }
  const mean = (xx + zz) / 2;
  const half = (xx - zz) / 2;
  const spread = Math.sqrt(Math.max(0, half * half + xz * xz));
  const angle = 0.5 * DMath.atan2(2 * xz, xx - zz);
  return {
    directionX: DMath.cos(angle),
    directionZ: DMath.sin(angle),
    major: Math.sqrt(mean + spread),
    minor: Math.sqrt(Math.max(0, mean - spread))
  };
};

/** A rock's footprint as one to three circles along its major axis. */
export const createRockColliders = (rock: RockInstance): ColliderInput[] => {
  const footprint = getRockFootprint(rock);
  if (footprint.minor < MIN_ROCK_RADIUS) return [];
  const ratio = Math.round(footprint.major / footprint.minor);
  const count = Math.min(MAX_ROCK_CIRCLES, Math.max(1, ratio));
  if (count === 1) {
    const { centre } = rock;
    return [{ ...ROCK_COLLIDER, radius: footprint.major, x: centre[0], z: centre[2] }];
  }
  const span = footprint.major - footprint.minor;
  const spacing = (span * 2) / (count - 1);
  const radius = Math.max(footprint.minor * 1.1, spacing * 0.6);
  return Array.from({ length: count }, (_, index) => {
    const offset = -span + index * spacing;
    return {
      ...ROCK_COLLIDER,
      radius,
      x: rock.centre[0] + footprint.directionX * offset,
      z: rock.centre[2] + footprint.directionZ * offset
    };
  });
};

/**
 * Every static obstacle of the island: tree trunks and, per species, the ring of low branches
 * it would reach into (baked from the tree meshes), blocking shrubs, stone
 * props and the sculpted rock layer (slabs, lip stones, rubble). `isGroundRock` drops rocks that
 * lie wholly inside unwalkable ground (cliff faces), which the walkability mask covers anyway.
 */
export const collectWorldColliders = (
  world: WorldData,
  rocks: readonly RockInstance[],
  isGroundRock: (x: number, z: number, radius: number) => boolean
) => {
  const colliders = collectPropColliders(world);
  for (const rock of rocks) {
    for (const collider of createRockColliders(rock)) {
      if (isGroundRock(collider.x, collider.z, collider.radius)) colliders.push(collider);
    }
  }
  return colliders;
};
