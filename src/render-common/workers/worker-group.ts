import type { WorldData } from "../../shared/world/world-data";
import { findSpotOutside } from "../relocation";
import { isSegmentWalkable, isStandFree, type NavWorld } from "../wildlife/nav/nav-query";
import { createWorkerCrowd } from "./worker-crowd";
import {
  assignFormationSlots,
  FORMATION_SPACING,
  type FormationPoint,
  listFormationSlots
} from "./worker-formation";
import { createWorkerNav } from "./worker-nav";
import {
  createWorkerUnit,
  findStandSpot,
  WORKER_NAV_SPECIES,
  type WorkerAppearance
} from "./worker-unit";
import { createSharedSight } from "./worker-vision";

/** Workers of the player at the start, next to the headquarters spot. */
export const START_WORKER_COUNT = 5;
/** Simulation step of the workers (seconds): small, so high refresh screens stay smooth. */
const FIXED_STEP = 1 / 120;
/** Steps one frame may catch up (a stalled tab does not fast-forward the workers). */
const MAX_STEPS_PER_FRAME = 12;
/** Seconds between worker ground refreshes while the building land changes. */
const GROUND_REFRESH_SECONDS = 0.5;
/** Starting workers stand a little wider apart than a marching formation. */
const START_SPACING = FORMATION_SPACING * 1.25;

/** Walkable and reachable in a straight line from the centre (not across water or a cliff). */
const createSlotCheck = (nav: NavWorld, center: FormationPoint) => (x: number, z: number) =>
  isStandFree(nav, WORKER_NAV_SPECIES, x, z) &&
  isSegmentWalkable(nav, WORKER_NAV_SPECIES, center.x, center.z, x, z);

const listSpawnPoints = (world: WorldData, nav: NavWorld, count: number) => {
  const center = findStandSpot(nav, world.start.x, world.start.z) ?? world.start;
  const slots = listFormationSlots(center, count, createSlotCheck(nav, center), START_SPACING);
  return Array.from({ length: count }, (_, index) => slots[index] ?? center);
};

/**
 * The player's workers: spawned in a loose group around the start, one shared sight (fog), a
 * selection, and commands that send the selected workers to a target in a loose formation.
 */
export const createWorkerGroup = (
  world: WorldData,
  baseNav: NavWorld,
  appearances: readonly WorkerAppearance[],
  /** False on a settlement island: its simulation writes the fog (A13 phase 2), the start workers do not. */
  revealsFog = true
) => {
  const workerNav = createWorkerNav(world, baseNav, WORKER_NAV_SPECIES);
  const { nav } = workerNav;
  const sight = revealsFog ? createSharedSight(world) : null;
  const spawns = listSpawnPoints(world, nav, appearances.length);
  const units = appearances.map((appearance, index) =>
    createWorkerUnit(world, nav, appearance, spawns[index], sight)
  );
  const frames = units.map((unit) => unit.frame);
  const listSelected = () => units.filter((unit) => unit.frame.selected);
  const crowd = createWorkerCrowd(nav, units);
  let pendingTime = 0;
  let buildRevision = world.buildRevision ?? 0;
  let groundAge = 0;

  /** The worker ground follows the building land (edits, felled trees), at most this often. */
  const followBuildLand = (delta: number) => {
    groundAge += delta;
    if (groundAge < GROUND_REFRESH_SECONDS || buildRevision === (world.buildRevision ?? 0)) return;
    groundAge = 0;
    buildRevision = world.buildRevision ?? 0;
    workerNav.refresh();
  };

  /**
   * Terrain edits: the workers inside `isInside` (or walking to a spot there) stop and move out
   * to the nearest spot outside where they may stand.
   */
  const relocateFrom = (isInside: (x: number, z: number) => boolean) => {
    const isFree = (x: number, z: number) => isStandFree(nav, WORKER_NAV_SPECIES, x, z);
    for (const unit of units) {
      const { frame } = unit;
      if (frame.target && isInside(frame.target.x, frame.target.z)) unit.stop();
      if (!isInside(frame.x, frame.z)) continue;
      unit.stop();
      const spot = findSpotOutside(frame.x, frame.z, isInside, isFree);
      if (spot) unit.place(spot.x, spot.z);
    }
  };

  /** Walks and collides in fixed steps (deterministic), then settles height and sight once. */
  const update = (delta: number) => {
    followBuildLand(delta);
    pendingTime = Math.min(pendingTime + Math.max(0, delta), FIXED_STEP * MAX_STEPS_PER_FRAME);
    while (pendingTime >= FIXED_STEP) {
      pendingTime -= FIXED_STEP;
      for (const unit of units) unit.move(FIXED_STEP);
      crowd.step(FIXED_STEP);
    }
    for (const unit of units) unit.settle();
    return frames;
  };

  /** One worker goes exactly to the point; several spread over formation slots around it. */
  const command = (x: number, z: number) => {
    const selected = listSelected();
    if (selected.length <= 1) return selected[0]?.command(x, z) ?? false;
    const center = { x, z };
    const slots = listFormationSlots(center, selected.length, createSlotCheck(nav, center));
    const assigned = assignFormationSlots(
      selected.map((unit) => unit.frame),
      slots
    );
    let moved = false;
    selected.forEach((unit, index) => {
      const slot = slots[assigned[index]!];
      if (slot && unit.command(slot.x, slot.z)) moved = true;
    });
    return moved;
  };

  return {
    command,
    frames,
    units,
    /** Selects exactly these flags (one per worker). */
    select: (flags: readonly boolean[]) => {
      units.forEach((unit, index) => unit.select(flags[index] === true));
    },
    relocateFrom,
    setObstacles: crowd.setObstacles,
    /** The animal navigation after a terrain edit: the worker ground is cut from it again. */
    setNav: (next: NavWorld) => workerNav.refresh(next),
    update
  };
};

export type WorkerGroup = ReturnType<typeof createWorkerGroup>;
