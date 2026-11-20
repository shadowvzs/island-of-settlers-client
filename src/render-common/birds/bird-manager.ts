import type { CellRegion } from "../../shared/world/grid-geometry";
import { createSimplexNoise, smoothstep } from "../../shared/world/noise";
import { createRandom, deriveSeed } from "../../shared/world/rng";
import type { WorldData } from "../../shared/world/world-data";
import { AMBIENT_DENSITY } from "../ambient-density";
import type { CameraState } from "../camera-state";
import type { EnvironmentState } from "../environment";
import type { WorkerNation } from "../workers/worker-unit";
import { createBirdBuildingAvoidance } from "./bird-building-avoidance";
import type { BirdBuilding } from "./bird-building-models";
import { createFlock, type FlockContext,setFlockMode, updateFlock } from "./bird-flock";
import { createBirdFrameWriter } from "./bird-frame-writer";
import { createHabitatField, refreshHabitatField, sampleHabitat } from "./bird-habitat";
import { createFlockLifecycle } from "./bird-lifecycle";
import { type BirdContext,updateBird } from "./bird-motion";
import {
  claimBirds,
  createBirdFrame,
  createBirdHistory,
  createBirdPool,
  rememberBird
} from "./bird-pool";
import { initFlock, pickFlockSize, pickSpawn, placeMembers } from "./bird-spawner";
import { BIRD_SPECIES } from "./bird-species";
import { createViewRegion, updateViewRegion } from "./bird-view";

/** Fixed simulation step: the same inputs give the same flight at any frame rate. */
const BIRD_STEP = 1 / 30;
const MAX_STEPS_PER_FRAME = 8;
export const BIRD_CAPACITY = 24;
const FLOCK_CAPACITY = 12;
/** Ground area of the view (world units squared) per active flock. */
const AREA_PER_FLOCK = 260;
const MEAN_SPAWN_SECONDS = 2.2;
const SCATTER_SPLIT_SECONDS = 2;

/** Heavy snowfall keeps birds down a little less than heavy rain. */
const SNOW_BIRD_HUSH = 0.6;

/** 0 (night, heavy rain: no new birds, flocks head home) .. 1 (a dry day). */
export const getBirdActivity = (environment: EnvironmentState) => {
  const weather = Math.max(environment.rain, environment.snow * SNOW_BIRD_HUSH);
  return (0.12 + 0.88 * environment.daylight) * (1 - smoothstep(0.25, 0.7, weather));
};

/** Share of the flocks dropped over full forest (owner: half as many birds around woods). */
const FOREST_BIRD_CUT = 0.5;
/** View points (centre and four half-extent offsets, in u / v units) averaged for the forest share. */
const FOREST_SAMPLE_POINTS: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [-0.5, 0],
  [0, 0.5],
  [0, -0.5]
];

/**
 * How many flocks the view holds: more ground in view, more flocks, scaled by activity; a view
 * over forest (share 0..1) holds up to FOREST_BIRD_CUT fewer.
 */
export const getDesiredFlocks = (viewArea: number, activity: number, forest = 0) =>
  Math.round(
    Math.min(FLOCK_CAPACITY, viewArea / AREA_PER_FLOCK + 1) *
      AMBIENT_DENSITY *
      activity *
      (1 - FOREST_BIRD_CUT * forest)
  );

/**
 * World level ambient birds: a fixed pool of birds in flocks (solo birds are flocks of one),
 * spawned near the view by habitat, time of day and weather, recycled out of view. Shared and
 * deterministic (fixed steps, seeded); renderers only read the BirdFrame. Gameplay never
 * depends on it; `scare` is the hook for future units, buildings and loud events.
 */
export const createBirdManager = (
  world: WorldData,
  options: {
    getBuildings?: () => readonly BirdBuilding[];
    /** The settlement's nation, whose architecture the buildings show. */
    getBuildingNation?: () => WorkerNation;
  } = {}
) => {
  const buildings = createBirdBuildingAvoidance();
  const field = createHabitatField(world);
  const random = createRandom(deriveSeed(world.seed, "birds"));
  const pool = createBirdPool(BIRD_CAPACITY);
  const history = createBirdHistory(BIRD_CAPACITY);
  const frame = createBirdFrame(BIRD_CAPACITY);
  const flocks = Array.from({ length: FLOCK_CAPACITY }, createFlock);
  const region = createViewRegion();
  const flockContext: FlockContext = {
    activity: 1,
    buildings,
    field,
    noise: createSimplexNoise(deriveSeed(world.seed, "bird-wander")),
    random,
    region,
    step: BIRD_STEP,
    time: 0
  };
  const birdContext: BirdContext = { buildings, field, random, step: BIRD_STEP, time: 0 };
  const { releaseFlock, updateLifecycle, updateSplit } = createFlockLifecycle(
    flockContext,
    pool,
    history
  );
  const writeFrame = createBirdFrameWriter(pool, history, frame, field);
  let enabled = true;
  let simTime = -1;
  let spawnTimer = 0.3;
  const position = { x: 0, y: 0, z: 0 };

  /** New construction can occupy an existing perch; move outside before writing interpolated frames. */
  const recoverBirds = () => {
    for (const flock of flocks) {
      if (!flock.active) continue;
      const radius = BIRD_SPECIES[flock.species]!.size * 0.6;
      if (
        flock.roof &&
        !buildings.validRoof(flock.roof, BIRD_SPECIES[flock.species]!.size, flock.size)
      ) {
        buildings.releaseRoof(flock);
        flock.roof = null;
        setFlockMode(flock, "scatter", Infinity);
        for (let member = 0; member < flock.size; member++)
          pool.settle[flock.members[member]!] = -1;
      }
      buildings.recover(flock, radius, flock.roof);
      if (
        (flock.mode === "land" || flock.mode === "rest") &&
        !buildings.clear(
          { x: flock.landX, y: flock.landY, z: flock.landZ },
          radius + (flock.roof ? 0 : 1.3),
          flock.roof
        )
      ) {
        setFlockMode(flock, "scatter", Infinity);
        for (let member = 0; member < flock.size; member++)
          pool.settle[flock.members[member]!] = -1;
      }
    }
    for (let bird = 0; bird < BIRD_CAPACITY; bird++) {
      if (pool.flock[bird] === -1) continue;
      position.x = pool.x[bird]!;
      position.y = pool.y[bird]!;
      position.z = pool.z[bird]!;
      if (
        !buildings.recover(
          position,
          BIRD_SPECIES[pool.species[bird]!]!.size * 0.6,
          flocks[pool.flock[bird]!]!.roof
        )
      )
        continue;
      pool.x[bird] = position.x;
      pool.y[bird] = position.y;
      pool.z[bird] = position.z;
      rememberBird(pool, history, bird);
    }
  };

  /** Forest share of the view: the habitat forest density averaged over a few view points. */
  const getViewForest = () => {
    let sum = 0;
    for (const [u, v] of FOREST_SAMPLE_POINTS) {
      const offsetU = u * region.halfU;
      const offsetV = v * region.halfV;
      const x = region.centerX + offsetU * region.cosYaw - offsetV * region.sinYaw;
      const z = region.centerZ + offsetU * region.sinYaw + offsetV * region.cosYaw;
      sum += sampleHabitat(field, field.forest, x, z);
    }
    return sum / FOREST_SAMPLE_POINTS.length;
  };

  const countActiveFlocks = () => {
    let count = 0;
    for (const flock of flocks) if (flock.active) count += 1;
    return count;
  };

  const findFreeFlock = () => {
    for (let index = 0; index < FLOCK_CAPACITY; index += 1)
      if (!flocks[index]!.active) return index;
    return -1;
  };

  const spawn = () => {
    const index = findFreeFlock();
    if (index < 0) return;
    const choice = pickSpawn(field, region, random, buildings);
    if (!choice) return;
    const flock = flocks[index]!;
    const size = pickFlockSize(BIRD_SPECIES[choice.species]!, random);
    if (!claimBirds(pool, size, index, flock.members)) return;
    initFlock(flock, choice, size, random);
    placeMembers(pool, history, flock, choice.fromPerch, random);
    recoverBirds();
  };

  const updateSpawning = () => {
    spawnTimer -= BIRD_STEP;
    if (spawnTimer > 0) return;
    const active = countActiveFlocks();
    const area = region.halfU * region.halfV * 4;
    const desired = getDesiredFlocks(area, flockContext.activity, getViewForest());
    const sparse = active < desired / 2 ? 0.35 : 1;
    spawnTimer = -Math.log(1 - random() * 0.95) * MEAN_SPAWN_SECONDS * sparse;
    if (active < desired) spawn();
  };

  const step = () => {
    flockContext.time += BIRD_STEP;
    birdContext.time = flockContext.time;
    recoverBirds();
    for (let bird = 0; bird < BIRD_CAPACITY; bird += 1)
      if (pool.flock[bird] !== -1) rememberBird(pool, history, bird);
    for (const flock of flocks) {
      if (!flock.active) continue;
      updateFlock(flock, flockContext);
      for (let member = 0; member < flock.size; member += 1)
        updateBird(pool, flock.members[member]!, flock, birdContext);
      updateSplit(flock);
      updateLifecycle(flock);
    }
    updateSpawning();
  };

  /** Advances the fixed steps up to `time` (seconds) and returns the frame for the renderers. */
  const update = (time: number, camera: CameraState, environment: EnvironmentState) => {
    if (!enabled) {
      frame.count = 0;
      return frame;
    }
    if (buildings.refresh(options.getBuildings?.() ?? [], options.getBuildingNation?.())) recoverBirds();
    updateViewRegion(region, camera);
    flockContext.activity = getBirdActivity(environment);
    if (simTime < 0) simTime = time;
    for (let steps = 0; simTime + BIRD_STEP <= time && steps < MAX_STEPS_PER_FRAME; steps += 1) {
      step();
      simTime += BIRD_STEP;
    }
    simTime = Math.max(simTime, time - BIRD_STEP);
    writeFrame((time - simTime) / BIRD_STEP);
    return frame;
  };

  /** Scatter hook: flocks near (x, z) burst away and climb, resting ones take off at once. */
  const scare = (x: number, z: number, radius: number) => {
    for (const flock of flocks) {
      if (!flock.active) continue;
      if (flock.mode === "rest") {
        const near = Math.hypot(flock.landX - x, flock.landZ - z) < radius;
        if (near) flock.modeLength = 0;
        continue;
      }
      if (Math.hypot(flock.x - x, flock.z - z) > radius + 2) continue;
      flock.course = Math.atan2(flock.z - z, flock.x - x);
      setFlockMode(flock, "scatter", Infinity);
      for (let member = 0; member < flock.size; member += 1) {
        const bird = flock.members[member]!;
        pool.detach[bird] = SCATTER_SPLIT_SECONDS * random();
        pool.detachSide[bird] = random() * 2 - 1;
        pool.flapBoost[bird] = 1.6;
        pool.settle[bird] = -1;
      }
    }
  };

  const setEnabled = (value: boolean) => {
    enabled = value;
    if (!value) for (const flock of flocks) if (flock.active) releaseFlock(flock);
    simTime = -1;
  };

  /** Map editor: the habitat blocks of the edited cells are measured again. */
  const refreshHabitat = (cells: CellRegion) => refreshHabitatField(world, field, cells);

  /** The habitat blocks are shared with other ambient life (butterflies, critters). */
  return {
    countVisible: () => frame.count,
    habitat: field,
    refreshHabitat,
    scare,
    setEnabled,
    update
  };
};

export type BirdManager = ReturnType<typeof createBirdManager>;
