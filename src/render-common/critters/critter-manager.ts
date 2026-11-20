import type { CellRegion } from "../../shared/world/grid-geometry";
import { createRandom, deriveSeed } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import { createBirdBuildingAvoidance } from "../birds/bird-building-avoidance";
import type { BirdBuilding } from "../birds/bird-building-models";
import type { HabitatField } from "../birds/bird-habitat";
import { createViewRegion, isInView, updateViewRegion } from "../birds/bird-view";
import type { CameraState } from "../camera-state";
import type { EnvironmentState } from "../environment";
import type { NavWorld } from "../wildlife/nav/nav-query";
import type { WorkerNation } from "../workers/worker-unit";
import { BEHAVIOUR, CRITTER_COLONIES } from "./critter-colonies";
import { CRITTER_SHADE, CRITTER_SPECIES } from "./critter-species";
import { createCritterSites } from "./habitat/critter-sites";
import { createCritterTerrain } from "./habitat/critter-terrain";
import { createClimbableTrees } from "./habitat/critter-trees";
import { CRITTER_BEHAVIOURS, placeMember } from "./sim/critter-behaviours";
import { createCritterBuildingFlight } from "./sim/critter-building-flight";
import { createCarcassActions, stepCritterCarcass } from "./sim/critter-carcass";
import type { CritterContext } from "./sim/critter-context";
import { createCritterCrowd, createCritterObstacles } from "./sim/critter-crowd";
import { createCritterFrameWriter } from "./sim/critter-frame-writer";
import {
  createSiteState,
  leaveSiteSlot,
  MAX_MEMBERS,
  refreshCritterHomes,
  updateHomeless
} from "./sim/critter-homes";
import {
  createCritterFrame,
  createCritterHistory,
  createCritterPool,
  findFreeCritter,
  rememberCritter
} from "./sim/critter-pool";
import { relocateGroundCritters } from "./sim/critter-relocation";
import { createRipples } from "./sim/critter-ripples";
import { chooseSites } from "./sim/critter-sites-view";
import { createThreats } from "./sim/critter-threats";

/** Fixed simulation step: the same inputs give the same critters at any frame rate. */
const CRITTER_STEP = 1 / 30;
const MAX_STEPS = 8;
export const CRITTER_CAPACITY = 144;
export const CRITTER_RIPPLES = 40;
/** Steps between two site choices (a quarter second). */
const CHOOSE_EVERY = 8;
const FADE_SECONDS = 0.7;
const RECYCLE_SECONDS = 1.5;
const VIEW_MARGIN = 2;
/** A site whose critter flew off stays empty this long (seconds). */
const AWAY_SECONDS = 75;
/** Members of these groups follow their site's first member (ducklings, pack, burrow). */
const FOLLOWING: ReadonlySet<number> = new Set([BEHAVIOUR.swim, BEHAVIOUR.roam, BEHAVIOUR.burrow]);

export interface CritterManagerOptions {
  getBuildings?: () => readonly BirdBuilding[];
  /** The settlement's nation, whose architecture the buildings show. */
  getBuildingNation?: () => WorkerNation;
  /** The birds' habitat field (forest density), shared instead of built again. */
  habitat?: HabitatField;
  /** Whether a tree still stands (felled trees are not climbed); all stand without it. */
  isTreeStanding?: (tree: number) => boolean;
  /** The wildlife navigation: forest critters walk only where the animals can. */
  nav?: NavWorld;
  /** Where the workers are (critters keep their distance). */
  getWorkers?: () => readonly { x: number; z: number }[];
}

/**
 * Decorative wildlife near the camera (ducks, herons, gulls, leaping fish ...): fixed homes per
 * island (deterministic per seed), occupied around the view by zoom, time of day and the fog of
 * war, simulated in fixed steps and recycled out of view. Food species (fish) always show; the
 * others follow the Critters setting. Shared and deterministic; renderers only read the frame.
 */
export const createCritterManager = (world: WorldData, options: CritterManagerOptions = {}) => {
  const terrain = createCritterTerrain(world, options.habitat);
  const sites = createCritterSites(terrain, CRITTER_COLONIES);
  const random = createRandom(deriveSeed(world.seed, "critter-life"));
  const pool = createCritterPool(CRITTER_CAPACITY);
  const history = createCritterHistory(CRITTER_CAPACITY);
  const frame = createCritterFrame(CRITTER_CAPACITY, CRITTER_RIPPLES);
  const ripples = createRipples(CRITTER_RIPPLES, terrain);
  const threats = createThreats(options.getWorkers);
  const region = createViewRegion();
  let state = createSiteState(sites.list.length);
  const chosen = new Set<number>();
  const context: CritterContext = {
    buildings: options.getBuildings ? createBirdBuildingAvoidance() : undefined,
    daylight: 1,
    emitRipple: (x, z, size) => ripples.emit(x, z, size),
    findThreat: threats.find,
    leaveSite: (site) => (state.awayUntil[site] = context.time + AWAY_SECONDS),
    nav: options.nav ?? null,
    trees: createClimbableTrees(world, options.isTreeStanding),
    random,
    sites: sites.list,
    step: CRITTER_STEP,
    terrain,
    time: 0
  };
  const crowd = createCritterCrowd(pool, context);
  const flight = context.buildings ? createCritterBuildingFlight(pool, context.buildings) : undefined;
  const writeFrame = createCritterFrameWriter({ frame, history, pool, ripples, terrain });
  let decorative = true;
  let environment: EnvironmentState | null = null;
  let camera: CameraState | null = null;
  let simTime = -1;
  let stepCount = 0;
  let excluded: ((x: number, z: number) => boolean) | undefined;
  const relocateFrom = (predicate: (x: number, z: number) => boolean) =>
    relocateGroundCritters(pool, context, predicate, (index) => rememberCritter(pool, history, index));

  const release = (index: number) => {
    pool.active[index] = 0;
    pool.carcass[index] = 0;
    leaveSiteSlot(state, pool, index);
  };

  const allows = (site: number) => {
    const entry = sites.list[site]!;
    if (entry.retired || (!entry.food && !decorative)) return false;
    if (state.awayUntil[site]! > context.time) return false;
    return state.occupied[site] === 1 || terrain.fog(entry.x, entry.z) >= 1;
  };

  const spawnMember = (site: number, member: number, leader: number) => {
    const entry = sites.list[site]!;
    const index = findFreeCritter(pool);
    if (index < 0) return -1;
    const behaviour = CRITTER_COLONIES[entry.colony]!.behaviour;
    const species = entry.members[member]!;
    const leaderPoint = leader >= 0 ? { x: pool.x[leader]!, z: pool.z[leader]! } : null;
    const point = placeMember(context, entry, behaviour, species, leaderPoint);
    const { sizeJitter: jitter } = CRITTER_SPECIES[species]!;
    pool.active[index] = 1;
    pool.appear[index] = 0;
    pool.behaviour[index] = behaviour;
    pool.heading[index] = random() * Math.PI * 2;
    pool.hidden[index] = 0;
    pool.homeless[index] = 0;
    pool.leader[index] = leader;
    pool.leaving[index] = 0;
    pool.member[index] = member;
    pool.outOfView[index] = 0;
    pool.scale[index] = CRITTER_SPECIES[species]!.size * (1 + (random() * 2 - 1) * jitter);
    pool.seed[index] = random();
    pool.shade[index] = CRITTER_SHADE.base + random() * CRITTER_SHADE.range;
    pool.site[index] = site;
    pool.species[index] = species;
    pool.speed[index] = 0;
    pool.x[index] = point.x;
    pool.z[index] = point.z;
    CRITTER_BEHAVIOURS[behaviour]!.spawn(pool, index, context);
    CRITTER_BEHAVIOURS[behaviour]!.update(pool, index, context);
    rememberCritter(pool, history, index);
    state.slots[site * MAX_MEMBERS + member] = index;
    return index;
  };

  const occupySite = (site: number) => {
    const entry = sites.list[site]!;
    state.occupied[site] = 1;
    const leader = spawnMember(site, 0, -1);
    const { behaviour } = CRITTER_COLONIES[entry.colony]!;
    const follows = FOLLOWING.has(behaviour);
    for (let member = 1; member < Math.min(MAX_MEMBERS, entry.members.length); member += 1) {
      spawnMember(site, member, follows ? leader : -1);
    }
  };

  const vacateSite = (site: number) => {
    for (let member = 0; member < MAX_MEMBERS; member += 1) {
      const index = state.slots[site * MAX_MEMBERS + member]!;
      if (index >= 0) pool.leaving[index] = 1;
    }
  };

  const chooseOccupied = () => {
    chooseSites(
      sites,
      { allows, camera: camera!, colonies: CRITTER_COLONIES, environment: environment!, region },
      chosen
    );
    for (let site = 0; site < state.occupied.length; site += 1) {
      const retired = sites.list[site]!.retired === true;
      if (state.occupied[site] === 1 && !chosen.has(site) && !retired) vacateSite(site);
    }
    for (const site of chosen) if (state.occupied[site] === 0) occupySite(site);
  };

  /** Fades in, fades out when leaving, released after a moment out of view. */
  const updateLifecycle = (index: number) => {
    const fade = CRITTER_STEP / FADE_SECONDS;
    const inView = isInView(region, pool.x[index]!, pool.y[index]!, pool.z[index]!, VIEW_MARGIN);
    updateHomeless(pool, index, CRITTER_STEP, inView);
    const leaving = pool.leaving[index] === 1;
    pool.appear[index] = Math.min(1, pool.appear[index]! + (leaving ? -fade : fade));
    pool.outOfView[index] = inView ? 0 : pool.outOfView[index]! + CRITTER_STEP;
    const gone = pool.appear[index]! <= 0 || (leaving && !inView);
    if (gone || (leaving && pool.outOfView[index]! > RECYCLE_SECONDS)) release(index);
  };

  /** A living critter runs its behaviour; a carcass falls, lies and fades. */
  const stepCritter = (index: number) => {
    if (pool.carcass[index] === 0) {
      CRITTER_BEHAVIOURS[pool.behaviour[index]!]!.update(pool, index, context);
      return true;
    }
    if (stepCritterCarcass(pool, index, context)) return true;
    release(index);
    return false;
  };

  const step = () => {
    context.time += CRITTER_STEP;
    if (stepCount % CHOOSE_EVERY === 0) chooseOccupied();
    stepCount += 1;
    threats.update(context.time);
    for (let index = 0; index < CRITTER_CAPACITY; index += 1) {
      if (pool.active[index] === 0) continue;
      flight?.recover(index);
      rememberCritter(pool, history, index);
      flight?.remember(index);
      if (stepCritter(index)) updateLifecycle(index);
      flight?.finish(index);
      if (pool.active[index] && flight?.recover(index)) rememberCritter(pool, history, index);
    }
    crowd.step();
    if (excluded) relocateFrom(excluded);
    ripples.step(CRITTER_STEP);
  };

  /** Advances the fixed steps up to `time` (seconds) and returns the frame for the renderers. */
  const update = (time: number, view: CameraState, current: EnvironmentState) => {
    camera = view;
    environment = current;
    context.daylight = current.daylight;
    updateViewRegion(region, view);
    if (context.buildings?.refresh(options.getBuildings?.() ?? [], options.getBuildingNation?.())) {
      for (let index = 0; index < CRITTER_CAPACITY; index++)
        if (pool.active[index] && flight?.recover(index)) rememberCritter(pool, history, index);
    }
    if (simTime < 0) simTime = time;
    for (let steps = 0; simTime + CRITTER_STEP <= time && steps < MAX_STEPS; steps += 1) {
      step();
      simTime += CRITTER_STEP;
    }
    simTime = Math.max(simTime, time - CRITTER_STEP);
    writeFrame((time - simTime) / CRITTER_STEP);
    return frame;
  };

  /** The Critters setting: off releases every decorative critter at once (food stays). */
  const setDecorativeEnabled = (value: boolean) => {
    decorative = value;
    if (value) return;
    for (let index = 0; index < CRITTER_CAPACITY; index += 1) {
      if (pool.active[index] === 1 && !sites.list[pool.site[index]!]!.food) release(index);
    }
  };

  /** Map editor: the homes follow the edited cells (see refreshCritterHomes). */
  const refreshHomes = (cells: CellRegion) => {
    const homes = { pool, scare: threats.scare, sites, terrain, trees: context.trees };
    state = refreshCritterHomes(homes, state, cells);
    context.sites = sites.list;
  };

  return {
    countVisible: () => frame.count,
    /** Every species living at the island's homes (members are fixed per home): the models to load. */
    presentSpecies: () => [...new Set(sites.list.flatMap((site) => site.members))],
    /** The live pool and the colony homes (tests, debug views). */
    debug: { pool, sites: sites.list },
    ...createCarcassActions(pool, release, threats.scare),
    /** The ground critters as moving obstacles of the animals and workers (collision). */
    obstacles: createCritterObstacles(pool),
    refreshHomes,
    relocateFrom,
    setExcluded: (predicate: (x: number, z: number) => boolean) => {
      excluded = predicate;
      relocateFrom(predicate);
    },
    /** Felling, a fleeing animal: critters around flee or fly off. */
    scare: threats.scare,
    setDecorativeEnabled,
    /** The animals' navigation after a map edit (forest critters walk where the animals can). */
    setNav: (nav: NavWorld) => (context.nav = nav),
    /** Workers and food animals the ground critters keep apart from (collision). */
    setObstacles: crowd.setObstacles,
    sites,
    update
  };
};

export type CritterManager = ReturnType<typeof createCritterManager>;
