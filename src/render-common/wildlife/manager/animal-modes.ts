import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../../../shared/math/deterministic-math";
import { type CellRegion, isRegionEmpty } from "../../../shared/world/grid-geometry";
import { deriveSeed } from "../../../shared/world/rng";
import { MAX_PATH_POINTS } from "../nav/nav-path";
import { ISLAND_ANIMAL_CAP } from "../population/wildlife-regions";
import { setAnimalAge } from "../sim/animal-age";
import { initVisualMotion } from "../sim/animal-animation";
import { placeOnGround } from "../sim/animal-locomotion";
import { clearAnimalSlot, REACTION } from "../sim/animal-pool";
import { applyIdentity, FOREST_STEPS } from "../sim/animal-spawn";
import {
  anchorRoutine,
  dormantAge,
  dormantAppear,
  type DormantPose,
  dormantRest,
  evaluateDormantPose,
  HOME_RANGE
} from "../sim/dormant-routine";
import { ANIMAL_STATE } from "../wildlife-species";
import type { AnimalManagerState } from "./animal-manager-state";

/** Ticks a region stays simulated after the last activity that touched it: 30 s (receipt). */
export const HOLD_TICKS = 600;
/** Touched areas grow by this (cells): a region animal never roams farther from its home. */
export const ROAM_MARGIN = HOME_RANGE + 6;
/** A region that is not calm when its hold ends is checked again this many ticks later. */
const CALM_RECHECK_TICKS = 20;
/** Ticks between AI decisions; woken animals are staggered over them by slot. */
const AI_TICKS = 2;
/** States of an animal that still reacts to something: its region stays simulated. */
const UNCALM_STATES = new Set<number>([ANIMAL_STATE.alert, ANIMAL_STATE.flee, ANIMAL_STATE.recover]);

/**
 * Active and dormant regions (design §5): a touched region simulates its animals for HOLD_TICKS
 * after the last touch; once calm, each animal is anchored to a closed-form routine (dormant,
 * no per-tick cost) and materialised again, at its routine pose of that tick, on the next touch.
 * Only simulation events touch regions, never the camera, so every host agrees.
 */
export const createAnimalModes = (state: AnimalManagerState) => {
  const { activeUntil, context, dormant, history, identity, pool, regions, world } = state;
  /** Active regions (order irrelevant: waking and anchoring share no stream). */
  const active: number[] = [];
  /** Regions a map script keeps awake (design §6.4 pins): they never go dormant. */
  const pinned = new Uint8Array(regions.count);

  /** Brain and route of a woken animal from its routine pose: walking on, or dwelling. */
  const applyPoseState = (slot: number, pose: DormantPose) => {
    const offset = slot * MAX_PATH_POINTS * 2;
    pool.state[slot] = pose.state;
    pool.stateTime[slot] = 0;
    pool.pathIndex[slot] = 0;
    pool.targetX[slot] = pose.targetX;
    pool.targetZ[slot] = pose.targetZ;
    if (!pose.walking) {
      pool.stateLength[slot] = pose.remainingTicks * TICK_SECONDS;
      pool.pathCount[slot] = 0;
      return;
    }
    // The leg was validated both ways when the routine was anchored: no search needed.
    pool.stateLength[slot] = Infinity;
    pool.path[offset] = pose.targetX;
    pool.path[offset + 1] = pose.targetZ;
    pool.pathCount[slot] = 1;
  };

  /** Clears what a dormant slot's drawing scratch or an old life left in the simulated fields. */
  const resetAwareness = (slot: number) => {
    pool.health[slot] = 1;
    pool.huntState[slot] = 0;
    pool.alertLevel[slot] = 0;
    pool.threatAge[slot] = 99;
    pool.reaction[slot] = REACTION.none;
    pool.reactionDelay[slot] = 0;
    pool.secondHand[slot] = 0;
    pool.blocked[slot] = 0;
    pool.lastThreatTime[slot] = -1;
    pool.aiTimer[slot] = (slot % AI_TICKS) * TICK_SECONDS;
  };

  /** A dormant animal becomes simulated at its routine pose of the current (whole) tick. */
  const materialise = (slot: number) => {
    const { tick } = context;
    const pose = evaluateDormantPose(dormant, slot, tick);
    const birth = { age: 0, birth: identity.birth[slot]!, forest: identity.forest[slot]! / FOREST_STEPS,
      sex: pool.sex[slot]! };
    const species = pool.species[slot]!, group = pool.group[slot]!;
    const homeX = pool.homeX[slot]!, homeZ = pool.homeZ[slot]!, homeRange = pool.homeRange[slot]!;
    clearAnimalSlot(pool, context.motion, history, slot);
    applyIdentity(context, slot, species, birth);
    pool.group[slot] = group;
    pool.homeX[slot] = homeX;
    pool.homeZ[slot] = homeZ;
    pool.homeRange[slot] = homeRange;
    identity.dormant[slot] = 0;
    pool.active[slot] = 1;
    pool.x[slot] = pose.x;
    pool.z[slot] = pose.z;
    pool.heading[slot] = pose.heading;
    pool.desiredHeading[slot] = pose.heading;
    pool.speed[slot] = pose.speed;
    pool.velocityX[slot] = pose.walking ? DMath.cos(pose.heading) * pose.speed : 0;
    pool.velocityZ[slot] = pose.walking ? DMath.sin(pose.heading) * pose.speed : 0;
    applyPoseState(slot, pose);
    resetAwareness(slot);
    setAnimalAge(pool, slot, dormantAge(dormant, slot, species, tick));
    pool.appear[slot] = dormantAppear(dormant, slot, tick);
    placeOnGround(context, slot);
    initVisualMotion(context, slot);
    state.remember(slot);
  };

  /** A simulated region animal goes dormant: its routine starts where it stands now. */
  const anchor = (slot: number) => {
    const { tick } = context;
    anchorRoutine(dormant, slot, {
      age: pool.age[slot]!,
      anchorTick: tick,
      appear: pool.appear[slot]!,
      heading: pool.heading[slot]!,
      homeX: pool.homeX[slot]!,
      homeZ: pool.homeZ[slot]!,
      nav: context.nav,
      routineSeed: deriveSeed(world.seed, `routine-${slot}-${identity.birth[slot]}-${tick}`) | 0,
      species: pool.species[slot]!,
      speedFactor: pool.speedFactor[slot]!,
      x: pool.x[slot]!,
      z: pool.z[slot]!
    });
    dormant.restAtAnchor[slot] = context.motion.rest[slot]!;
    identity.dormant[slot] = 1;
    pool.active[slot] = 0;
    pool.pending[slot] = 0;
    pool.alertLevel[slot] = 0;
    pool.speed[slot] = 0;
    pool.velocityX[slot] = 0;
    pool.velocityZ[slot] = 0;
    pool.pathCount[slot] = 0;
  };

  const forRegionAnimals = (region: number, visit: (slot: number) => void) => {
    for (let slot = 0; slot < ISLAND_ANIMAL_CAP; slot += 1) {
      if (identity.homeRegion[slot] === region) visit(slot);
    }
  };

  const wake = (region: number) => {
    active.push(region);
    activeUntil[region] = context.tick;
    forRegionAnimals(region, (slot) => {
      if (identity.dormant[slot]) materialise(slot);
    });
  };

  /** Activity in a region: it is simulated (woken now if dormant) for HOLD_TICKS more. */
  const touchRegion = (region: number) => {
    if (region < 0 || region >= regions.count) return;
    if (activeUntil[region]! < 0) wake(region);
    activeUntil[region] = Math.max(activeUntil[region]!, context.tick + HOLD_TICKS);
  };

  /** Activity around (x, z) within `radius` cells: every region an animal there may call home. */
  const touchCircle = (x: number, z: number, radius: number) =>
    regions.forEachRegionInCircle(x, z, radius + ROAM_MARGIN, touchRegion);

  /** Activity in a cell region (edits, building plots): its regions and their neighbours' reach. */
  const touchCells = (cells: CellRegion) => {
    if (isRegionEmpty(cells)) return;
    regions.forEachRegionInCells({
      maxX: cells.maxX + ROAM_MARGIN, maxZ: cells.maxZ + ROAM_MARGIN,
      minX: cells.minX - ROAM_MARGIN, minZ: cells.minZ - ROAM_MARGIN
    }, touchRegion);
  };

  const wakeAll = () => {
    for (let region = 0; region < regions.count; region += 1) touchRegion(region);
  };

  /** No animal of the region reacts to anything, waits to appear or is hunted. */
  const isCalm = (region: number) => {
    for (let slot = 0; slot < ISLAND_ANIMAL_CAP; slot += 1) {
      if (identity.homeRegion[slot] !== region || identity.dormant[slot] || !pool.active[slot]) continue;
      if (pool.pending[slot] || pool.huntState[slot] || pool.reaction[slot] !== REACTION.none) return false;
      if (UNCALM_STATES.has(pool.state[slot]!)) return false;
    }
    return true;
  };

  const sleep = (region: number) => {
    forRegionAnimals(region, (slot) => {
      if (pool.active[slot] && !identity.dormant[slot]) anchor(slot);
    });
    activeUntil[region] = -1;
  };

  /** Per tick: active regions whose hold ran out go dormant once calm. */
  const stepSleep = () => {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      const region = active[index]!;
      if (pinned[region] || context.tick < activeUntil[region]!) continue;
      if (!isCalm(region)) {
        activeUntil[region] = context.tick + CALM_RECHECK_TICKS;
        continue;
      }
      sleep(region);
      active.splice(index, 1);
    }
  };

  /**
   * The map script's pinned regions (derived from the script at its start or load): dormant ones wake now, and
   * none of them sleeps again. An already active region keeps its hold time, so a reload changes nothing.
   */
  const setPinned = (pins: readonly number[]) => {
    pinned.fill(0);
    for (const region of pins) {
      if (region < 0 || region >= regions.count) continue;
      pinned[region] = 1;
      if (activeUntil[region]! < 0) wake(region);
    }
  };

  /** Dormant animals standing inside `isInside` wake with their regions (plots, edited ground). */
  const wakeInside = (isInside: (x: number, z: number) => boolean) => {
    for (let slot = 0; slot < ISLAND_ANIMAL_CAP; slot += 1) {
      if (!identity.dormant[slot]) continue;
      const pose = evaluateDormantPose(dormant, slot, context.tick);
      if (isInside(pose.x, pose.z)) touchRegion(identity.homeRegion[slot]!);
    }
  };

  /**
   * Presentation scratch for drawing a dormant animal at fractional `tick`: pose, age and fade
   * into its pool and history fields. The simulation never reads them (a wake overwrites them).
   */
  const poseForDrawing = (slot: number, tick: number) => {
    const pose = evaluateDormantPose(dormant, slot, tick);
    pool.x[slot] = pose.x;
    pool.z[slot] = pose.z;
    pool.heading[slot] = pose.heading;
    pool.state[slot] = pose.state;
    pool.speed[slot] = pose.speed;
    pool.velocityX[slot] = pose.walking ? DMath.cos(pose.heading) * pose.speed : 0;
    pool.velocityZ[slot] = pose.walking ? DMath.sin(pose.heading) * pose.speed : 0;
    setAnimalAge(pool, slot, dormantAge(dormant, slot, pool.species[slot]!, tick));
    pool.appear[slot] = dormantAppear(dormant, slot, tick);
    context.motion.rest[slot] = dormantRest(dormant, slot, pool.species[slot]!, tick);
    placeOnGround(context, slot);
    history.x[slot] = pool.x[slot]!;
    history.y[slot] = pool.y[slot]!;
    history.z[slot] = pool.z[slot]!;
    history.heading[slot] = pool.heading[slot]!;
  };

  /** Active regions and their hold ends (ascending regions: a save does not depend on wake order). */
  const saveActive = () => {
    const sorted = [...active].sort((a, b) => a - b);
    return { regions: Int32Array.from(sorted), until: Int32Array.from(sorted, (region) => activeUntil[region]!) };
  };

  const loadActive = (saved: { regions: ArrayLike<number>; until: ArrayLike<number> }) => {
    active.length = 0;
    activeUntil.fill(-1);
    for (let index = 0; index < saved.regions.length; index += 1) {
      const region = saved.regions[index]!;
      active.push(region);
      activeUntil[region] = saved.until[index]!;
    }
  };

  return {
    anchor,
    countActive: () => active.length,
    isRegionActive: (region: number) => region >= 0 && activeUntil[region]! >= 0,
    loadActive,
    poseForDrawing,
    saveActive,
    setPinned,
    stepSleep,
    touchCells,
    touchCircle,
    touchRegion,
    wakeAll,
    wakeInside
  };
};

export type AnimalModes = ReturnType<typeof createAnimalModes>;
