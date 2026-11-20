import { TREE_GROWTH_SECONDS } from "../../shared/balance/economy";
import { createRandom } from "../../shared/world/rng";
import type { GrowthStage } from "../trees/tree-model";

/** Spread of start times (the growth time is TREE_GROWTH_SECONDS). */
const START_SPREAD_SECONDS = 12;
/** Every growing tree ends as a mature tree, whatever its world variant. */
export const MATURE_STAGE: GrowthStage = 5;

/** A tree that is not mature yet. */
export interface GrowingTree {
  id: number;
  /** 0..1 through the current stage: the size eases towards the next stage's mesh. */
  progress: number;
  stage: GrowthStage;
}

/** What renderers read each frame; empty while growth is off. */
export interface GrowthFrame {
  growing: () => Iterable<GrowingTree>;
  /** Trees that finished growing: they stand mature until growth is switched off. */
  grownIds: () => Iterable<number>;
  isGrown: (id: number) => boolean;
  isGrowing: (id: number) => boolean;
  /** Changes whenever a tree starts or finishes growing (renderers re-sync only then). */
  revision: () => number;
}

/**
 * Stage and progress of a tree `age` seconds after it started: stages 1 .. 4 share
 * TREE_GROWTH_SECONDS while the tree swells towards the next stage's size; null once it is mature.
 * Before its start a tree waits as a sprout.
 */
export const getGrowthState = (age: number): Omit<GrowingTree, "id"> | null => {
  const spans = MATURE_STAGE - 1;
  const stages = (Math.max(0, age) / TREE_GROWTH_SECONDS) * spans;
  if (stages >= spans) return null;
  const stage = (1 + Math.floor(stages)) as GrowthStage;
  return { progress: stages - (stage - 1), stage };
};

/** The next game second at which `getGrowthState` changes stage, or null when the tree is mature. */
export const nextTreeGrowthTime = (startTime: number, time: number, speed = 1) => {
  if (!(speed > 0)) return null;
  const age = Math.max(0, (time - startTime) * speed);
  if (age >= TREE_GROWTH_SECONDS) return null;
  const span = TREE_GROWTH_SECONDS / (MATURE_STAGE - 1);
  return startTime + (Math.floor(age / span) + 1) * span / speed;
};

/**
 * Tree growth on the island: when switched on every standing tree (`canGrow`) restarts as a
 * sprout and grows within TREE_GROWTH_SECONDS to a mature tree; start times are spread so the forest
 * does not grow in lockstep. Grown trees stay mature; switching off brings back the world forest
 * (felled grown trees keep their mature stump).
 */
/**
 * The trees that start as sprouts when growth is switched on: `share` of them (0..1), picked by
 * the seed in their listed order, so the same island always sprouts the same trees.
 */
export const pickSproutingTrees = (ids: readonly number[], seed: number, share: number) => {
  const random = createRandom(seed);
  return ids.filter(() => random() < share);
};

export const createTreeGrowth = (
  ids: Iterable<number>,
  seed: number,
  canGrow: (id: number) => boolean
) => {
  let trees = [...ids];
  const planted = new Map<number, number>();
  let current = new Map<number, GrowingTree>();
  /** The previous update's growing trees (swapped with `current`): stage changes are found without allocating. */
  let previous = new Map<number, GrowingTree>();
  const grown = new Set<number>();
  const jobPlanted = new Set<number>();
  /** Trees taken away (map editor) and whether they had finished growing (an undo returns them). */
  const removed = new Map<number, boolean>();
  /** Live undo preserves planted age; map history itself is intentionally not a runtime save. */
  const removedPlantedAges = new Map<number, number>();
  let now = 0;
  let revision = 0;
  let running = false;
  /** Growth seconds per real second: the player's tree growth talent (1 without it). */
  let speed = 1;
  /** Growth age of a planted tree: real seconds since its start at the current speed. */
  const ageOf = (startTime: number) => (now - startTime) * speed;
  /** Who hears a planted tree become mature (wildlife capacity follows forestry). */
  const grownListeners: ((id: number) => void)[] = [];
  /** Who hears a growing tree reach its next stage in `update` (map scripts, TRG3b). */
  const stageListeners: ((id: number, stage: GrowthStage) => void)[] = [];
  const announceStage = (id: number, stage: GrowthStage) => {
    for (const listener of stageListeners) listener(id, stage);
  };
  const markGrown = (id: number) => {
    grown.add(id);
    for (const listener of grownListeners) listener(id);
  };

  /** Restarts the growth at the last updated time. */
  const start = () => {
    running = true;
    const random = createRandom(seed);
    for (const id of planted.keys()) if (!jobPlanted.has(id)) planted.delete(id);
    for (const id of trees) {
      if (jobPlanted.has(id)) continue;
      const delay = random() * START_SPREAD_SECONDS;
      if (!canGrow(id)) continue;
      planted.set(id, now + delay);
      grown.delete(id);
    }
    revision += 1;
  };

  const stop = () => {
    running = false;
    for (const id of planted.keys()) if (!jobPlanted.has(id)) planted.delete(id);
    for (const id of current.keys()) if (!jobPlanted.has(id)) current.delete(id);
    for (const id of grown) if (canGrow(id) && !jobPlanted.has(id)) grown.delete(id);
    revision += 1;
  };

  const update = (time: number) => {
    now = time;
    const swapped = previous;
    previous = current;
    current = swapped;
    current.clear();
    for (const [id, startTime] of planted) {
      const state = getGrowthState(ageOf(startTime));
      const before = previous.get(id)?.stage;
      if (state) {
        current.set(id, { id, ...state });
        if (before !== undefined && before !== state.stage) announceStage(id, state.stage);
        continue;
      }
      planted.delete(id);
      markGrown(id);
      if (before !== undefined) announceStage(id, MATURE_STAGE);
      revision += 1;
    }
  };

  const frame: GrowthFrame = {
    growing: () => current.values(),
    grownIds: () => grown.values(),
    isGrown: (id) => grown.has(id),
    isGrowing: (id) => current.has(id),
    revision: () => revision
  };

  /** Trees gone from the world (map editor): they neither grow nor stand grown any more. */
  const remove = (ids: readonly number[]) => {
    const gone = new Set(ids);
    for (const id of trees) if (gone.has(id)) removed.set(id, grown.has(id));
    trees = trees.filter((id) => !gone.has(id));
    for (const id of gone) {
      if (jobPlanted.has(id)) removedPlantedAges.set(id,
        planted.has(id) ? Math.max(0, ageOf(planted.get(id)!)) : TREE_GROWTH_SECONDS);
      planted.delete(id);
      current.delete(id);
      grown.delete(id);
      jobPlanted.delete(id);
    }
    revision += 1;
  };

  /**
   * Trees an undo (or redo) brought back: the ones growth knew grow again, a sprout again while
   * growth is on (a tree that had finished stands grown); other trees (placed by the editor,
   * mature at once) are not growth's.
   */
  const restore = (ids: readonly number[]) => {
    for (const id of ids) {
      const wasGrown = removed.get(id);
      if (wasGrown === undefined) continue;
      removed.delete(id);
      trees.push(id);
      const plantedAge = removedPlantedAges.get(id);
      if (plantedAge !== undefined && canGrow(id)) {
        removedPlantedAges.delete(id); plant(id, plantedAge); continue;
      }
      if (!running || !canGrow(id)) continue;
      if (wasGrown) grown.add(id);
      else planted.set(id, now);
      revision += 1;
    }
  };

  const plant = (id: number, ageSeconds = 0) => {
    const age = Number.isFinite(ageSeconds) ? Math.max(0, Math.min(TREE_GROWTH_SECONDS, ageSeconds)) : 0;
    if (!trees.includes(id)) trees.push(id);
    jobPlanted.add(id);
    planted.set(id, now - age / speed);
    grown.delete(id);
    const state = getGrowthState(age);
    if (state) current.set(id, { id, ...state });
    else { planted.delete(id); current.delete(id); markGrown(id); }
    revision += 1;
  };
  /**
   * The tree growth talent changed: every growing tree keeps the growth it has, then grows on at the
   * new speed (start times are rebased, so saves keep real start times at the saved speed).
   */
  const setSpeed = (next: number) => {
    if (!(next > 0) || next === speed) return;
    for (const [id, startTime] of planted) planted.set(id, now - ageOf(startTime) / next);
    speed = next;
  };
  /** The next absolute stage boundary across all planted trees, for the event core. */
  const nextBoundary = (time: number) => {
    let next = Infinity;
    for (const startTime of planted.values()) {
      const boundary = nextTreeGrowthTime(startTime, time, speed);
      if (boundary !== null) { if (boundary < next) next = boundary; continue; }
      // `nextTreeGrowthTime` reports null at maturity, but the tree stays planted until `update`
      // moves it to grown. A mature tree that is still planted is due now: report `time` so the
      // caller runs the update on this tick instead of dropping the boundary (and the tree never
      // becoming harvestable if no other tree has a later boundary).
      if ((time - startTime) * speed >= TREE_GROWTH_SECONDS && time < next) next = time;
    }
    return Number.isFinite(next) ? next : null;
  };
  /** Event-core ownership: keep planted/removed start times on the current tick without a full update. */
  const setNow = (time: number) => { now = time; };
  const saveState = () => ({ trees, planted: [...planted], grown: [...grown], jobPlanted: [...jobPlanted],
    removed: [...removed], now, running, speed });
  const loadState = (saved: ReturnType<typeof saveState>) => {
    trees = [...saved.trees]; planted.clear(); grown.clear(); jobPlanted.clear(); removed.clear(); current.clear();
    removedPlantedAges.clear();
    for (const [id, time] of saved.planted) planted.set(id,time);
    for (const id of saved.grown) grown.add(id);
    for (const id of saved.jobPlanted) jobPlanted.add(id);
    for (const [id, mature] of saved.removed) removed.set(id,mature);
    running=saved.running; speed = saved.speed; update(saved.now); revision++;
  };
  /** `listener` hears every tree that finishes growing (by `update`, or planted already mature). */
  const onGrown = (listener: (id: number) => void) => {
    grownListeners.push(listener);
  };
  /** `listener` hears every growing tree that reaches its next stage (2 .. 4, then 5 when it matures). */
  const onStage = (listener: (id: number, stage: GrowthStage) => void) => {
    stageListeners.push(listener);
  };
  return { nextBoundary, onGrown, onStage, plant, remove, restore, saveState, loadState, frame, setNow, setSpeed, start,
    stop, update };
};
