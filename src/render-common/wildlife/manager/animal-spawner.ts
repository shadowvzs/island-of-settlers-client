import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../../../shared/math/deterministic-math";
import { DEFAULT_AUTHORED_ANIMAL_AGE, validAuthoredAnimals } from "../../../shared/world/authored-animals";
import { somePropNear } from "../../../shared/world/prop-cell-index";
import { isBodyFree } from "../nav/nav-query";
import {
  findHerdLeader,
  findRegionSpot,
  pickRegionSpecies,
  placement,
  type RegionPlacementQuery,
  sampleRegionHabitat
} from "../population/region-spawner";
import { type LedgerOutcome, RETRY_TICKS } from "../population/respawn-ledger";
import { ISLAND_ANIMAL_CAP } from "../population/wildlife-regions";
import { growAnimals, turnToFit } from "../sim/animal-age";
import { ANIMAL_APPEAR_INTERVAL, stepAnimalAppearance } from "../sim/animal-appearance";
import { createPlacedRespawns, findFreeSlot, placeAdult } from "../sim/animal-placement";
import { clearAnimalSlot } from "../sim/animal-pool";
import { createBirth, createIdentityRandom, FOREST_STEPS, initAnimal } from "../sim/animal-spawn";
import { evaluateDormantPose, HOME_RANGE } from "../sim/dormant-routine";
import { animalBodyRoom, authoredAnimalGround, authoredAnimalSlot } from "./animal-editor-placement";
import type { AnimalManagerState } from "./animal-manager-state";
import type { AnimalModes } from "./animal-modes";

const RESPAWN_INTERVAL = 0.5;
/**
 * Ledger entries tried per respawn cadence at most (each tries up to 24 spots): a dense forest
 * without room cannot turn its retries into a CPU spike; the others wait for the next cadence.
 */
const SPAWN_ATTEMPTS_PER_CADENCE = 8;
/** Trees around a birth place (cells) that make it deep forest (rabbit coat bias 1). */
const FOREST_NEAR = { full: 12, reach: 4 } as const;

/**
 * Births and respawns: the regions' animals (from the respawn ledger, by their herd leader when
 * one lives), the editor placed adults and their respawn timers, and the growth of the young.
 */
export const createAnimalSpawner = (state: AnimalManagerState, modes: AnimalModes) => {
  const { context, field, identity, ledger, pool, regions, world } = state;
  const leaderSpot = { x: 0, z: 0 };
  const placedRespawns = createPlacedRespawns(world);
  /** Habitat part of each region's species mix (derived; dropped when its habitat changes). */
  const habitats: (Float32Array | undefined)[] = [];
  let respawnTimer = 0;
  /** Births so far: every new individual gets fresh identity seeds. */
  let births = 0;
  let nextAppearanceTime = 0;

  const scheduleAppearance = (slot: number) => {
    pool.pending[slot] = 1;
    pool.appear[slot] = 0;
    pool.arrivalTime[slot] = Math.max(context.time, nextAppearanceTime);
    nextAppearanceTime = pool.arrivalTime[slot]! + ANIMAL_APPEAR_INTERVAL;
  };

  const habitatOf = (region: number) =>
    habitats[region] ??= sampleRegionHabitat(world, regions, field, region);

  /** 0 meadow .. 1 deep forest: standing mature trees around the birth place. */
  const forestAround = (x: number, z: number) => {
    let trees = 0;
    somePropNear(world, x, z, FOREST_NEAR.reach, (id) => {
      if (!state.isTreeProp(id) || !state.isMatureTree(id)) return false;
      if (DMath.hypot(world.props.x[id]! - x, world.props.z[id]! - z) > FOREST_NEAR.reach) return false;
      trees += 1;
      return trees >= FOREST_NEAR.full;
    });
    return trees / FOREST_NEAR.full;
  };

  /** Where the leader stands now (simulated or on its routine), or null to spawn anywhere. */
  const findLeaderSpot = (leader: number) => {
    if (leader < 0) return null;
    if (pool.active[leader] && !pool.pending[leader]) {
      leaderSpot.x = pool.x[leader]!;
      leaderSpot.z = pool.z[leader]!;
      return leaderSpot;
    }
    if (!identity.dormant[leader]) return null;
    const pose = evaluateDormantPose(state.dormant, leader, context.tick);
    leaderSpot.x = pose.x;
    leaderSpot.z = pose.z;
    return leaderSpot;
  };

  const createQuery = (species: number, leader: number, slot: number): RegionPlacementQuery => ({
    canPlace: (x, z) => animalBodyRoom(state, species, x, z, ISLAND_ANIMAL_CAP),
    field,
    nav: context.nav,
    near: findLeaderSpot(leader),
    random: context.random.at("wildlife.placement", slot),
    world
  });

  /** Brings the new animal to life where `placement` points; false when its body fits no heading. */
  const bear = (slot: number, species: number, leader: number, birth: number, respawn: boolean) => {
    clearAnimalSlot(pool, context.motion, state.history, slot);
    pool.x[slot] = placement.x;
    pool.z[slot] = placement.z;
    const home = { centreX: placement.x, centreZ: placement.z, range: HOME_RANGE };
    const traits = { forest: forestAround(placement.x, placement.z), leader: leader < 0, respawn };
    const newborn = createBirth(world, slot, birth, traits);
    initAnimal(context, slot, species, leader < 0 ? slot : leader, home, newborn);
    if (turnToFit(context, slot)) {
      identity.birth[slot] = birth;
      identity.forest[slot] = Math.round(newborn.forest * FOREST_STEPS);
      return true;
    }
    pool.active[slot] = 0;
    return false;
  };

  /**
   * The herd a newborn joins (or -1: it leads itself) with `placement` on a valid spot: next to
   * the leader, else anywhere in the region on its own; null when neither has room.
   */
  const placeNewborn = (region: number, species: number, slot: number, birth: number) => {
    const joinRoll = createIdentityRandom(world, "herd", slot, birth)();
    const leader = findHerdLeader(pool, identity, region, species, ISLAND_ANIMAL_CAP, joinRoll);
    if (findRegionSpot(regions, region, species, createQuery(species, leader, slot))) return leader;
    if (leader < 0) return null;
    return findRegionSpot(regions, region, species, createQuery(species, -1, slot)) ? -1 : null;
  };

  /**
   * A new animal of the region: species by its habitat, a herd to join, a valid spot. In an
   * active region it appears in turn; in a dormant one it is born dormant and fades in.
   */
  const spawnRegionAnimal = (region: number, respawn: boolean) => {
    const slot = findFreeSlot(pool, 0, ISLAND_ANIMAL_CAP, identity.dormant);
    if (slot < 0) return false;
    const birth = births + 1;
    const random = context.random.at("wildlife.species", region);
    const species = pickRegionSpecies(habitatOf(region), regions.trees[region]!, random);
    const leader = placeNewborn(region, species, slot, birth);
    if (leader === null) return false;
    births = birth;
    if (!bear(slot, species, leader, birth, respawn)) return false;
    state.claimHome(slot, region);
    if (modes.isRegionActive(region)) {
      scheduleAppearance(slot);
      return true;
    }
    pool.appear[slot] = 0;
    modes.anchor(slot);
    return true;
  };

  /** The island's first population: every region's target; failures retry a little later. */
  const spawnInitialPopulation = () => {
    for (let region = 0; region < regions.count; region += 1) {
      for (let animal = 0; animal < regions.target[region]!; animal += 1) {
        if (!spawnRegionAnimal(region, false)) ledger.schedule(region, context.tick + RETRY_TICKS);
      }
    }
  };

  /** A due ledger entry: spawn unless the region is full already. */
  const resolveEntry = (region: number): LedgerOutcome => {
    if (regions.population[region]! >= regions.target[region]!) return "drop";
    return spawnRegionAnimal(region, true) ? "spawned" : "retry";
  };

  /**
   * Places an animal at its initial normalized age at (x, z) (map editor), at home there; false when
   * the ground is not walkable for it or every editor slot is taken.
   */
  const placeAnimal = (
    species: number, x: number, z: number, age = DEFAULT_AUTHORED_ANIMAL_AGE, deferUntilClear = false
  ) => {
    const valid = deferUntilClear ? validAuthoredAnimals([{ species, x, z, age }], world.cellsX, world.cellsZ)
      : authoredAnimalGround(state, species, x, z, age) && animalBodyRoom(state, species, x, z);
    if (!valid) return false;
    const slot = authoredAnimalSlot(state, species, x, z);
    if (slot < 0) return false;
    births += 1;
    clearAnimalSlot(pool, context.motion, state.history, slot);
    const placed = placeAdult(context, slot, species, { x, z }, births, age, deferUntilClear);
    if (placed) scheduleAppearance(slot);
    return placed;
  };

  /** A region follower appears next to its leader when the leader is up and about. */
  const joinLeader = (slot: number) => {
    const leader = pool.group[slot]!;
    if (leader === slot || !pool.active[leader] || pool.pending[leader]) return;
    const species = pool.species[slot]!;
    const region = identity.homeRegion[slot]!;
    if (!findRegionSpot(regions, region, species, createQuery(species, leader, slot))) return;
    pool.x[slot] = placement.x;
    pool.z[slot] = placement.z;
    pool.homeX[slot] = placement.x;
    pool.homeZ[slot] = placement.z;
    turnToFit(context, slot);
    state.remember(slot);
  };

  /** Terrain or building exclusions changed while it waited: another spot of its region. */
  const relocatePending = (slot: number) => {
    const region = identity.homeRegion[slot]!;
    if (region < 0) return false;
    const species = pool.species[slot]!;
    if (!findRegionSpot(regions, region, species, createQuery(species, -1, slot))) return false;
    pool.x[slot] = placement.x;
    pool.z[slot] = placement.z;
    return turnToFit(context, slot);
  };

  /** A placed arrival waits while its ground or room is taken. */
  const isPlacedArrivalBlocked = (slot: number) => {
    const species = pool.species[slot]!, x = pool.x[slot]!, z = pool.z[slot]!;
    return !authoredAnimalGround(state, species, x, z, pool.age[slot]!) ||
      !animalBodyRoom(state, species, x, z, 0, slot);
  };

  /** A reserved arrival whose turn came becomes physical (or waits a little longer). */
  const appear = (slot: number) => {
    const placed = slot >= ISLAND_ANIMAL_CAP;
    if (placed && isPlacedArrivalBlocked(slot)) {
      pool.arrivalTime[slot] = context.time + .5;
      return;
    }
    if (!placed) joinLeader(slot);
    if (!turnToFit(context, slot)) {
      if (placed || !relocatePending(slot)) {
        scheduleAppearance(slot);
        return;
      }
      state.remember(slot);
    }
    pool.pending[slot] = 0;
  };

  /** Reserved arrivals become physical only when their turn comes, near their current living leader. */
  const stepAppearances = () => {
    for (let slot = 0; slot < pool.active.length; slot++) {
      if (pool.pending[slot] && pool.arrivalTime[slot]! <= context.time + 1e-6) appear(slot);
      stepAnimalAppearance(pool, slot, TICK_SECONDS);
    }
  };

  const hasRoomToGrow = (animal: number, scale: number) =>
    isBodyFree(
      context.nav,
      pool.species[animal]!,
      pool.x[animal]!,
      pool.z[animal]!,
      pool.heading[animal]!,
      scale
    );

  /** Per step: every RESPAWN_INTERVAL the due ledger entries and timers resolve, the young grow. */
  const stepRespawns = () => {
    respawnTimer -= TICK_SECONDS;
    if (respawnTimer > 0) return;
    respawnTimer = RESPAWN_INTERVAL;
    ledger.resolve(context.tick, resolveEntry, SPAWN_ATTEMPTS_PER_CADENCE);
    placedRespawns.update(RESPAWN_INTERVAL, placeAnimal);
    growAnimals(pool, RESPAWN_INTERVAL, hasRoomToGrow);
  };

  const saveState = () => ({ births, nextAppearanceTime, respawnTimer, waiting: placedRespawns.saveState() });
  const loadState = (saved: ReturnType<typeof saveState>) => {
    if (!saved || !Number.isFinite(saved.respawnTimer) || !Number.isSafeInteger(saved.births) ||
      !Number.isFinite(saved.nextAppearanceTime)) throw new Error("Invalid saved wildlife births");
    births = saved.births;
    nextAppearanceTime = saved.nextAppearanceTime;
    respawnTimer = saved.respawnTimer;
    placedRespawns.loadState(saved.waiting);
  };

  return {
    births: () => births,
    /** The region's habitat changed (edits): its species mix is sampled again on the next birth. */
    invalidateHabitat: (region: number) => {
      habitats[region] = undefined;
    },
    loadState,
    /** An editor placed animal died: it comes back at its home later. */
    onPlacedDeath: placedRespawns.onDeath,
    placeAnimal,
    saveState,
    spawnInitialPopulation,
    stepAppearances,
    stepRespawns
  };
};

export type AnimalSpawner = ReturnType<typeof createAnimalSpawner>;
