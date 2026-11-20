import { auditRandom } from "../../../shared/settlement/simulation-random";
import { createRandom, createStatefulRandom, deriveSeed } from "../../../shared/world/rng";
import type { WorldData } from "../../../shared/world/world-data";
import { createViewRegion } from "../../birds/bird-view";
import { getTreeSpecies } from "../../props/island-trees";
import { createPathFinder } from "../nav/nav-path";
import type { NavWorld } from "../nav/nav-query";
import { createRespawnLedger } from "../population/respawn-ledger";
import { createWildlifeRegions, ISLAND_ANIMAL_CAP } from "../population/wildlife-regions";
import { createAnimalCrowd } from "../sim/animal-crowd";
import { createHabitatField } from "../sim/animal-habitat";
import { PLACED_ANIMAL_SLOTS } from "../sim/animal-placement";
import {
  createAnimalFrame,
  createAnimalHistory,
  createAnimalPool,
  createMotionPool,
  MAX_VISIBLE_ANIMALS
} from "../sim/animal-pool";
import { createDormantPool } from "../sim/dormant-routine";
import type { WildlifeContext } from "../sim/wildlife-context";

type RemovedListener = (animal: number) => void;

/** The removed-animal listeners (killed, editor removed, left its region). */
const createRemovedEvent = () => {
  const listeners: RemovedListener[] = [];
  return {
    emit: (animal: number) => {
      for (const listener of listeners) listener(animal);
    },
    listen: (listener: RemovedListener) => listeners.push(listener)
  };
};

/** What the manager's owner knows about the island that the wildlife rules need. */
export interface AnimalManagerOptions {
  /** A tree prop counts for wildlife capacity only while it stands mature (default: always). */
  isMatureTree?: (id: number) => boolean;
}

/**
 * Who each slot is: its birth number (seeds), rabbit coat forest bias (FOREST_STEPS), home region
 * (-1 placed or gone) and whether it is dormant (closed-form routine, not simulated).
 */
export interface AnimalIdentity {
  birth: Int32Array;
  dormant: Uint8Array;
  forest: Uint8Array;
  homeRegion: Int32Array;
}

/**
 * The shared live state of one island's animals: regions and their counters, the respawn
 * ledger, pools, identity, dormant routines, frame, crowd and the simulation context the
 * spawner, modes, stepper and events modules work on.
 */
export const createAnimalManagerState = (world: WorldData, nav: NavWorld, options: AnimalManagerOptions = {}) => {
  const field = createHabitatField(world, nav);
  /** Region slots first, then room for the animals the map editor places. */
  const capacity = ISLAND_ANIMAL_CAP + PLACED_ANIMAL_SLOTS;
  const pool = createAnimalPool(capacity);
  const history = createAnimalHistory(capacity);
  const motion = createMotionPool(capacity);
  const crowd = createAnimalCrowd(pool, motion, () => context.nav);
  const context: WildlifeContext = {
    field,
    finder: createPathFinder(nav),
    isCrowded: (animal) => crowd.isCrowded(animal),
    motion,
    nav,
    pathBudget: 0,
    pool,
    random: auditRandom("wildlife", createStatefulRandom(deriveSeed(world.seed, "animals"))),
    region: createViewRegion(),
    tick: 0,
    time: 0,
    visualRandom: createRandom(deriveSeed(world.seed, "animal-visuals")),
    world
  };
  const identity: AnimalIdentity = {
    birth: new Int32Array(capacity),
    dormant: new Uint8Array(capacity),
    forest: new Uint8Array(capacity),
    homeRegion: new Int32Array(capacity).fill(-1)
  };
  const dormant = createDormantPool(capacity);
  const ledger = createRespawnLedger();
  /**
   * `started`: the tree counters were built from the world (first step); `spawned`: the first
   * population was born (saved); `reconciling`: the ledger follows every target and population
   * change (after the start).
   */
  const flags = { reconciling: false, spawned: false, started: false };
  const regions = createWildlifeRegions(world, (region) => {
    if (!flags.reconciling) return;
    ledger.reconcile(region, regions.target[region]!, regions.population[region]!, context.tick);
  });
  /** Hold time per region (tick after which it may sleep), -1 while dormant. */
  const activeUntil = new Int32Array(regions.count).fill(-1);
  let populationTotal = 0;

  /** Keeps the animal's current pose as the previous step (interpolation start). */
  const remember = (animal: number) => {
    history.x[animal] = pool.x[animal]!;
    history.y[animal] = pool.y[animal]!;
    history.z[animal] = pool.z[animal]!;
    history.heading[animal] = pool.heading[animal]!;
  };

  /** A new animal belongs to its region. */
  const claimHome = (slot: number, region: number) => {
    identity.homeRegion[slot] = region;
    regions.population[region] = regions.population[region]! + 1;
    populationTotal += 1;
  };

  /** Herd mates of a leader that is gone lead themselves (its slot may be reused). */
  const releaseFollowers = (leader: number) => {
    for (let slot = 0; slot < ISLAND_ANIMAL_CAP; slot += 1) {
      if (slot !== leader && pool.group[slot] === leader) pool.group[slot] = slot;
    }
  };

  /** An animal of a region is gone (killed, left, cancelled): the ledger owes one 5 minutes out. */
  const releaseHome = (slot: number) => {
    const region = identity.homeRegion[slot]!;
    if (region < 0) return;
    identity.homeRegion[slot] = -1;
    identity.dormant[slot] = 0;
    regions.population[region] = regions.population[region]! - 1;
    populationTotal -= 1;
    releaseFollowers(slot);
    if (flags.reconciling) {
      ledger.reconcile(region, regions.target[region]!, regions.population[region]!, context.tick);
    }
  };

  /** Rebuilds the region population counters from the identity (after a load). */
  const recountPopulation = () => {
    regions.population.fill(0);
    populationTotal = 0;
    for (let slot = 0; slot < ISLAND_ANIMAL_CAP; slot += 1) {
      const region = identity.homeRegion[slot]!;
      if (region < 0) continue;
      regions.population[region] = regions.population[region]! + 1;
      populationTotal += 1;
    }
  };

  return {
    activeUntil,
    capacity,
    claimHome,
    context,
    crowd,
    dormant,
    field,
    flags,
    frame: createAnimalFrame(MAX_VISIBLE_ANIMALS),
    history,
    identity,
    isMatureTree: options.isMatureTree ?? (() => true),
    /** A world prop that is a tree (standing or not). */
    isTreeProp: (id: number) => getTreeSpecies(world.props.types[id]!) !== undefined,
    ledger,
    nav,
    pool,
    populationTotal: () => populationTotal,
    recountPopulation,
    regions,
    releaseHome,
    remember,
    removed: createRemovedEvent(),
    world
  };
};

export type AnimalManagerState = ReturnType<typeof createAnimalManagerState>;
