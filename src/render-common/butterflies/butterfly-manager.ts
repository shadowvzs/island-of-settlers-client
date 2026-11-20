import { createRandom, deriveSeed } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import type { HabitatField } from "../birds/bird-habitat";
import { createViewRegion, getViewDistance, isInView, updateViewRegion } from "../birds/bird-view";
import type { CameraState } from "../camera-state";
import type { EnvironmentState } from "../environment";
import { getButterflyActivity, getButterflyCap, getDesiredButterflies } from "./butterfly-flight";
import { createButterflyFrameWriter } from "./butterfly-frame-writer";
import { createButterflyField, refreshButterflyProps } from "./butterfly-habitat";
import { type ButterflyContext,updateButterfly } from "./butterfly-motion";
import {
  createButterflyFrame,
  createButterflyHistory,
  createButterflyPool,
  rememberButterfly
} from "./butterfly-pool";
import { createButterflySpawner } from "./butterfly-spawner";

/** Fixed simulation step: the same inputs give the same flight at any frame rate. */
const BUTTERFLY_STEP = 1 / 30;
const MAX_STEPS = 8;
/** Pool size: the hard cap at the closest zoom. */
export const BUTTERFLY_CAPACITY = 3;
const MEAN_SPAWN_SECONDS = 0.9;
const VIEW_MARGIN = 1.5;
const RECYCLE_SECONDS = 1;
const FADE_SECONDS = 0.8;

/**
 * Near-camera butterflies: a small fixed pool spawned in suitable spots of the view (flowery
 * meadows, river banks, forest edges and clearings) by day and in dry weather, capped by the
 * zoom (none when zoomed out), recycled out of view. Shared and deterministic (fixed steps,
 * seeded); renderers only read the ButterflyFrame. Visual only.
 */
export const createButterflyManager = (world: WorldData, habitat: HabitatField) => {
  const field = createButterflyField(world, habitat);
  const random = createRandom(deriveSeed(world.seed, "butterflies"));
  const pool = createButterflyPool(BUTTERFLY_CAPACITY);
  const history = createButterflyHistory(BUTTERFLY_CAPACITY);
  const frame = createButterflyFrame(BUTTERFLY_CAPACITY);
  const region = createViewRegion();
  const context: ButterflyContext = { field, random, step: BUTTERFLY_STEP, time: 0 };
  const trySpawn = createButterflySpawner(context, pool, history, region);
  const writeFrame = createButterflyFrameWriter(pool, history, frame, habitat);
  let desired = 0;
  let enabled = true;
  let simTime = -1;
  let spawnTimer = 0.4;

  const release = (index: number) => {
    pool.active[index] = 0;
    pool.flower[index] = -1;
  };

  const releaseAll = () => {
    for (let index = 0; index < BUTTERFLY_CAPACITY; index += 1) release(index);
  };

  const hasActive = () => {
    for (let index = 0; index < BUTTERFLY_CAPACITY; index += 1)
      if (pool.active[index] === 1) return true;
    return false;
  };

  const countStaying = () => {
    let count = 0;
    for (let index = 0; index < BUTTERFLY_CAPACITY; index += 1)
      if (pool.active[index] === 1 && pool.leaving[index] === 0) count += 1;
    return count;
  };

  const updateSpawning = () => {
    spawnTimer -= BUTTERFLY_STEP;
    if (spawnTimer > 0) return;
    const staying = countStaying();
    /** Sparse (just zoomed in, morning): fill up faster. */
    const sparse = staying < desired / 2 ? 0.35 : 1;
    spawnTimer = -Math.log(1 - random() * 0.95) * MEAN_SPAWN_SECONDS * sparse;
    if (staying < desired) trySpawn();
  };

  /** Over the cap (zoomed out a little, dusk, rain): the farthest one fades away. */
  const trimToDesired = () => {
    if (countStaying() <= desired) return;
    let farthest = -1;
    let farthestDistance = -1;
    for (let index = 0; index < BUTTERFLY_CAPACITY; index += 1) {
      if (pool.active[index] === 0 || pool.leaving[index] === 1) continue;
      const distance = getViewDistance(region, pool.x[index]!, pool.z[index]!);
      if (distance <= farthestDistance) continue;
      farthest = index;
      farthestDistance = distance;
    }
    if (farthest >= 0) pool.leaving[farthest] = 1;
  };

  /** Fades in, fades out when leaving, recycled after a moment out of view. */
  const updateLifecycle = (index: number) => {
    const fade = BUTTERFLY_STEP / FADE_SECONDS;
    const leaving = pool.leaving[index] === 1;
    pool.appear[index] = Math.min(1, pool.appear[index]! + (leaving ? -fade : fade));
    const inView = isInView(region, pool.x[index]!, pool.y[index]!, pool.z[index]!, VIEW_MARGIN);
    pool.outOfView[index] = inView ? 0 : pool.outOfView[index]! + BUTTERFLY_STEP;
    if (pool.appear[index]! <= 0 || pool.outOfView[index]! > RECYCLE_SECONDS) release(index);
  };

  const step = () => {
    context.time += BUTTERFLY_STEP;
    for (let index = 0; index < BUTTERFLY_CAPACITY; index += 1) {
      if (pool.active[index] === 0) continue;
      rememberButterfly(pool, history, index);
      updateButterfly(pool, index, context);
      updateLifecycle(index);
    }
    trimToDesired();
    updateSpawning();
  };

  const stop = () => {
    releaseAll();
    simTime = -1;
    frame.count = 0;
    return frame;
  };

  /** Advances the fixed steps up to `time` (seconds) and returns the frame for the renderers. */
  const update = (time: number, camera: CameraState, environment: EnvironmentState) => {
    if (!enabled) return frame;
    /** Zoomed out: off entirely (no steps, nothing pooled). */
    if (getButterflyCap(camera.zoom) === 0) return stop();
    desired = getDesiredButterflies(camera.zoom, getButterflyActivity(environment));
    if (desired === 0 && !hasActive()) return stop();
    updateViewRegion(region, camera);
    if (simTime < 0) simTime = time;
    for (let steps = 0; simTime + BUTTERFLY_STEP <= time && steps < MAX_STEPS; steps += 1) {
      step();
      simTime += BUTTERFLY_STEP;
    }
    simTime = Math.max(simTime, time - BUTTERFLY_STEP);
    writeFrame((time - simTime) / BUTTERFLY_STEP);
    return frame;
  };

  const setEnabled = (value: boolean) => {
    enabled = value;
    stop();
  };

  return {
    countVisible: () => frame.count,
    /** Map editor: props were placed or removed (flowers to land on, obstacles). */
    refreshProps: () => refreshButterflyProps(field),
    setEnabled,
    update
  };
};

export type ButterflyManager = ReturnType<typeof createButterflyManager>;
