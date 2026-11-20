import { TICK_SECONDS } from "../../../../../island-of-settlers-shared/src/time/constants";
import { DMath } from "../../../shared/math/deterministic-math";
import { getViewDistance, isInView, updateViewRegion } from "../../birds/bird-view";
import type { CameraState } from "../../camera-state";
import { createVertexFog } from "../../chunk-sampling";
import { animateVisual, stepRest } from "../sim/animal-animation";
import { think } from "../sim/animal-brain";
import { stepCarcasses } from "../sim/animal-carcass";
import { createFrameWriter } from "../sim/animal-frame-writer";
import { stepAnimal } from "../sim/animal-locomotion";
import { MAX_VISIBLE_ANIMALS } from "../sim/animal-pool";
import { HOME_RANGE } from "../sim/dormant-routine";
import {
  getWaypointX,
  getWaypointZ,
  hasRoute,
  resetPathBudget
} from "../sim/wildlife-context";
import type { AnimalManagerState } from "./animal-manager-state";
import type { AnimalModes } from "./animal-modes";
import type { AnimalSpawner } from "./animal-spawner";

/** Steps a frame may catch up when no settlement drives the wildlife (editor, previews). */
const MAX_STEPS_PER_FRAME = 6;
/** Drawn up to this view distance (a margin for tall animals at the screen edge). */
const DRAW_DISTANCE = 1.25;
/** A dormant animal is never farther than this from its home (cells): the drawing pre-cull. */
const DORMANT_REACH = HOME_RANGE + 6;
/** Seconds between AI decisions of every animal (two settlement ticks). */
const AI_INTERVAL = 0.1;
/** Longest frame the visual animation advances at once (seconds; hidden tabs, hitches). */
const MAX_ANIMATION_DT = 0.1;
/** Float32 timers: a remainder this small counts as elapsed. */
const TIMER_EPSILON = 1e-6;
/** Coarse (offline) steps: a wounded escape circling its waypoint this long gives up (s). */
const STALL_SECONDS = 2;

interface EscapeProgress {
  index: number;
  remaining: number;
  stalled: number;
}

/**
 * The fixed step simulation: every simulated animal thinks and moves once per settlement tick,
 * dormant ones cost nothing (closed-form routines), whatever the camera shows; each frame packs
 * the drawn animals, interpolated between the last two steps. `start` builds the population on
 * the first step.
 */
export const createAnimalStepper = (
  state: AnimalManagerState,
  modes: AnimalModes,
  spawner: AnimalSpawner,
  start: () => void
) => {
  const { capacity, context, crowd, frame, history, identity, pool, remember, world } = state;
  const vertexFog = createVertexFog(world);
  const writeAnimal = createFrameWriter(context, history, vertexFog);
  const escapes = new Map<number, EscapeProgress>();
  let fogRevision = world.fogRevision ?? 0;
  /** Render time of the last self-driven step (-1 before the first frame). */
  let selfDrivenTime = -1;
  /** Render time of the last frame (-1 before the first). */
  let frameTime = -1;

  const moveLiving = (animal: number, dt: number, interval: number) => {
    pool.aiTimer[animal]! -= dt;
    if (pool.aiTimer[animal]! <= TIMER_EPSILON) {
      think(context, animal, interval);
      pool.aiTimer[animal] = AI_INTERVAL;
    }
    stepAnimal(context, animal, dt);
    stepRest(context, animal, dt);
  };

  /** One simulation tick of the whole island's wildlife. */
  const step = () => {
    start();
    context.tick += 1;
    context.time += TICK_SECONDS;
    resetPathBudget(context);
    stepCarcasses(pool, TICK_SECONDS);
    spawner.stepAppearances();
    for (let animal = 0; animal < capacity; animal += 1) {
      if (!pool.active[animal] || pool.pending[animal]) continue;
      remember(animal);
      moveLiving(animal, TICK_SECONDS, AI_INTERVAL);
    }
    crowd.step(TICK_SECONDS);
    spawner.stepRespawns();
    modes.stepSleep();
  };

  /**
   * Coarse integration keeps route arrival honest: a wounded escape that circles its waypoint
   * without approaching it is given up at the native hunted-escape blocked boundary.
   */
  const watchEscape = (animal: number, dt: number) => {
    if (pool.huntState[animal] !== 1 || !hasRoute(pool, animal)) {
      escapes.delete(animal);
      return;
    }
    const remaining = DMath.hypot(getWaypointX(pool, animal) - pool.x[animal]!,
      getWaypointZ(pool, animal) - pool.z[animal]!);
    const previous = escapes.get(animal);
    const progressing = !previous || previous.index !== pool.pathIndex[animal] ||
      remaining < previous.remaining - 1e-6;
    const stalled = progressing ? 0 : previous.stalled + dt;
    escapes.set(animal, { index: pool.pathIndex[animal]!,
      remaining: progressing ? remaining : previous.remaining, stalled });
    if (stalled >= STALL_SECONDS) pool.blocked[animal] = Math.max(2, pool.blocked[animal]!);
  };

  /** A coarse step of one animal: hunted ones keep the native step (route arrival tolerance). */
  const moveCoarse = (animal: number, dt: number) => {
    const substeps = pool.huntState[animal] ? Math.round(dt / TICK_SECONDS) : 1;
    const movementDt = dt / substeps;
    for (let substep = 0; substep < substeps; substep += 1) {
      moveLiving(animal, movementDt, Math.max(AI_INTERVAL, movementDt));
    }
    watchEscape(animal, dt);
  };

  /**
   * The offline (coarse) mode of the same rules: `dt` seconds (whole ticks) at once for movement,
   * births, respawns and growth on their native tick cadence; dormant regions cost nothing.
   */
  const stepCoarse = (dt: number) => {
    start();
    const ticks = Math.round(dt / TICK_SECONDS);
    const firstTick = context.tick;
    context.tick += ticks;
    context.time += dt;
    resetPathBudget(context);
    stepCarcasses(pool, dt);
    spawner.stepAppearances();
    for (let animal = 0; animal < capacity; animal += 1) {
      if (!pool.active[animal] || pool.pending[animal]) continue;
      remember(animal);
      moveCoarse(animal, dt);
    }
    crowd.step(dt);
    for (let tick = 1; tick <= ticks; tick += 1) {
      context.tick = firstTick + tick;
      spawner.stepRespawns();
    }
    modes.stepSleep();
  };

  /** A dormant animal near the view gets its routine pose of the render tick; false when culled. */
  const poseDormant = (animal: number, renderTick: number) => {
    const { region } = context;
    const margin = DORMANT_REACH + (DRAW_DISTANCE - 1) * Math.max(region.halfU, region.halfV);
    if (!isInView(region, pool.homeX[animal]!, 0, pool.homeZ[animal]!, margin)) return false;
    modes.poseForDrawing(animal, renderTick);
    return getViewDistance(region, pool.x[animal]!, pool.z[animal]!) <= DRAW_DISTANCE;
  };

  /** Whether the slot is drawn this frame (simulated pose, dormant pose, carcass or fade). */
  const isDrawn = (animal: number, renderTick: number) => {
    if (identity.dormant[animal]) return poseDormant(animal, renderTick);
    const living = pool.active[animal] === 1 && pool.pending[animal] === 0;
    if (!living && !pool.carcass[animal] && !pool.departing[animal]) return false;
    return getViewDistance(context.region, pool.x[animal]!, pool.z[animal]!) <= DRAW_DISTANCE;
  };

  /**
   * Packs the animals in view, interpolated `alpha` (0..1) between the last two steps; their
   * visual animation advances `dt` seconds.
   */
  const writeFrame = (alpha: number, dt: number) => {
    const renderTick = context.tick - 1 + alpha;
    let count = 0;
    for (let animal = 0; animal < capacity && count < MAX_VISIBLE_ANIMALS; animal += 1) {
      if (!isDrawn(animal, renderTick)) continue;
      if (pool.active[animal] || identity.dormant[animal]) animateVisual(context, animal, dt);
      writeAnimal(frame, animal, count, alpha);
      count += 1;
    }
    frame.count = count;
  };

  /** Re-samples the fog of war after it changed (the frame writer hides fogged animals). */
  const refreshFog = () => {
    if (fogRevision === (world.fogRevision ?? 0)) return;
    fogRevision = world.fogRevision ?? 0;
    vertexFog.set(createVertexFog(world));
  };

  /** Without a settlement the render clock steps the wildlife; returns the interpolation. */
  const stepSelfDriven = (time: number) => {
    if (selfDrivenTime < 0) selfDrivenTime = time;
    for (
      let steps = 0;
      selfDrivenTime + TICK_SECONDS <= time && steps < MAX_STEPS_PER_FRAME;
      steps += 1
    ) {
      step();
      selfDrivenTime += TICK_SECONDS;
    }
    selfDrivenTime = Math.max(selfDrivenTime, time - TICK_SECONDS);
    return (time - selfDrivenTime) / TICK_SECONDS;
  };

  /**
   * The renderer frame at render `time` (seconds). `tickFraction` is the settlement's share of
   * its next tick when the settlement steps the wildlife; without it the render clock does.
   */
  const update = (time: number, camera: CameraState, tickFraction?: number) => {
    refreshFog();
    updateViewRegion(context.region, camera);
    const dt = frameTime < 0 ? 0 : Math.min(MAX_ANIMATION_DT, Math.max(0, time - frameTime));
    frameTime = time;
    writeFrame(tickFraction ?? stepSelfDriven(time), dt);
    return frame;
  };

  return { step, stepCoarse, update };
};
