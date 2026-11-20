import { DMath } from "../../../shared/math/deterministic-math";
import { DEFAULT_AUTHORED_ANIMAL_AGE, MAX_AUTHORED_ANIMALS } from "../../../shared/world/authored-animals";
import { somePropNear } from "../../../shared/world/prop-cell-index";
import type { WorldData } from "../../../shared/world/world-data";
import { getTreeSpecies } from "../../props/island-trees";
import { findSpotOutside } from "../../relocation";
import { isBodyFree } from "../nav/nav-query";
import { RESPAWN_SECONDS } from "../population/respawn-ledger";
import { turnToFit } from "./animal-age";
import type { AnimalPool } from "./animal-pool";
import { createBirth, initAnimal } from "./animal-spawn";
import type { WildlifeContext } from "./wildlife-context";

/** Pool slots after the region slots for animals the map editor places. */
export const PLACED_ANIMAL_SLOTS = MAX_AUTHORED_ANIMALS;
/** Legacy placements retain their grown-adult initial age. */
const PLACED_AGE = DEFAULT_AUTHORED_ANIMAL_AGE;
/**
 * It stays local: it roams around the spot it was placed on (cells, plus the species' home
 * margin) with shorter wander legs, never across the island (the navigation does not know the
 * editor's changes, so short local legs keep it on ground the checks still describe well).
 */
const PLACED_HOME_RADIUS = 3;
/** The roaming margin a forest home used to add (cells), kept for placed animals. */
const PLACED_HOME_MARGIN = 4;
/** Rabbit coat bias of a placed animal (half way between meadow and deep forest). */
const PLACED_FOREST = 0.5;
const PLACED_WANDER_SCALE = 0.6;
/** A dead placed animal comes back only in a forest: this many trees within the reach (cells). */
const FOREST_HOME = { reach: 6, trees: 4 } as const;

/**
 * First unreserved slot in [from, until): no living animal, pending birth, carcass, departure mesh
 * or dormant animal (`dormant` marks those).
 */
export const findFreeSlot = (
  pool: AnimalPool, from: number, until = pool.active.length, dormant?: Uint8Array
) => {
  for (let slot = from; slot < until; slot += 1) {
    if (pool.active[slot] || pool.carcass[slot] || pool.departing[slot] || dormant?.[slot]) continue;
    return slot;
  }
  return -1;
};

/**
 * Brings an adult of the species to life in the slot at the spot, at home there and leading
 * itself; false (slot left free) when its body does not fit on walkable ground in any heading.
 * `birth` numbers the individual (fresh identity seeds).
 */
export const placeAdult = (
  context: WildlifeContext,
  slot: number,
  species: number,
  spot: { x: number; z: number },
  birth: number,
  age = PLACED_AGE,
  deferPlacement = false
) => {
  const { pool, world } = context;
  pool.carcass[slot] = 0;
  pool.x[slot] = spot.x;
  pool.z[slot] = spot.z;
  const home = { centreX: spot.x, centreZ: spot.z, range: PLACED_HOME_RADIUS + PLACED_HOME_MARGIN };
  const identity = createBirth(world, slot, birth, { forest: PLACED_FOREST, leader: false, respawn: false });
  initAnimal(context, slot, species, slot, home, { ...identity, age });
  pool.wanderScale[slot] = pool.wanderScale[slot]! * PLACED_WANDER_SCALE;
  if (deferPlacement || turnToFit(context, slot)) return true;
  pool.active[slot] = 0;
  return false;
};

/** Enough trees around (x, z) for a forest habitat (respawn of placed animals). */
export const isForestHome = (world: WorldData, x: number, z: number) => {
  const { props } = world;
  let trees = 0;
  return somePropNear(world, x, z, FOREST_HOME.reach, (index) => {
    if (getTreeSpecies(props.types[index]!) === undefined) return false;
    if (DMath.hypot(props.x[index]! - x, props.z[index]! - z) > FOREST_HOME.reach) return false;
    trees += 1;
    return trees >= FOREST_HOME.trees;
  });
};

interface PlacedRespawn {
  species: number;
  timer: number;
  x: number;
  z: number;
}

/**
 * Respawns of placed animals: one that dies comes back at its home after RESPAWN_SECONDS, only
 * when the home is a forest habitat (no respawn without trees); a failed spawn retries later.
 */
export const createPlacedRespawns = (world: WorldData) => {
  const waiting: PlacedRespawn[] = [];
  const onDeath = (species: number, x: number, z: number) => {
    if (isForestHome(world, x, z)) waiting.push({ species, timer: RESPAWN_SECONDS, x, z });
  };
  const update = (dt: number, place: (species: number, x: number, z: number) => boolean) => {
    for (const entry of Array.from(waiting)) {
      entry.timer -= dt;
      if (entry.timer > 0) continue;
      if (place(entry.species, entry.x, entry.z)) waiting.splice(waiting.indexOf(entry), 1);
      else entry.timer = RESPAWN_SECONDS / 4;
    }
  };
  return { onDeath, update, saveState: () => waiting.map(entry=>({...entry})),
    loadState: (saved: typeof waiting) => {
      if(!Array.isArray(saved) || !saved.every(entry=>entry &&
        [entry.species,entry.timer,entry.x,entry.z].every(Number.isFinite)))
        throw new Error("Invalid saved wildlife respawns");
      waiting.splice(0,waiting.length,...saved);
    } };

};

/**
 * Moves an animal out of an area (map editor terrain edits) to the nearest spot outside where
 * its body fits; its path is dropped, it starts afresh there. Left where it is when none fits.
 */
export const moveOutside = (
  context: WildlifeContext,
  animal: number,
  isInside: (x: number, z: number) => boolean
) => {
  const { nav, pool } = context;
  const species = pool.species[animal]!;
  const isFree = (x: number, z: number) =>
    isBodyFree(nav, species, x, z, pool.heading[animal]!);
  const spot = findSpotOutside(pool.x[animal]!, pool.z[animal]!, isInside, isFree);
  if (!spot) return false;
  pool.x[animal] = spot.x;
  pool.z[animal] = spot.z;
  pool.pathCount[animal] = 0;
  return true;
};
