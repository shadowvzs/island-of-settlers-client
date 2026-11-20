import { collectChoppableTrees } from "../render-common/felling/felling-trees";
import { createTreeGrowth, pickSproutingTrees } from "../render-common/growth/tree-growth";
import { deriveSeed } from "../shared/world/rng";
import type { WorldData } from "../shared/world/world-data";

/** New maps start with the whole forest mature; only trees planted later grow from seedlings. */
const SPROUTING_SHARE = 0;

/**
 * Every planted seedling grows automatically to maturity. `update(time)` takes the island's absolute
 * time: the settlement's tick clock on a played island, so a reload continues it exactly.
 */
export const createIslandGrowth = (world: WorldData, canGrow: (id: number) => boolean) => {
  const trees = collectChoppableTrees(world).map(([id]) => id);
  const sproutSeed = deriveSeed(world.seed, "sprouting-trees");
  const ids = pickSproutingTrees(trees, sproutSeed, SPROUTING_SHARE);
  const growth = createTreeGrowth(ids, deriveSeed(world.seed, "growth"), canGrow);

  // The standing-tree predicate depends on felling, constructed immediately after growth.
  let started = false;

  return {
    saveState: growth.saveState,
    loadState: (saved: ReturnType<typeof growth.saveState>) => {
      growth.loadState(saved); started = true;
    },
    /** What renderers read when the settlement's ticks drive the growth. */
    frame: growth.frame,
    isGrowing: growth.frame.isGrowing,
    isGrown: growth.frame.isGrown,
    nextBoundary: growth.nextBoundary,
    /** A planted tree finished growing (the wildlife regions count it from now on). */
    onGrown: growth.onGrown,
    /** A growing tree reached its next stage (map scripts). */
    onStage: growth.onStage,
    remove: growth.remove,
    restore: growth.restore,
    plant: growth.plant,
    setNow: growth.setNow,
    setSpeed: growth.setSpeed,
    update: (time: number) => {
      if (!started) {
        started = true;
        growth.start();
        for (const [id, age] of Object.entries(world.authoredTreeAges ?? {}))
          if (canGrow(Number(id))) growth.plant(Number(id), age);
      }
      growth.update(time);
      return growth.frame;
    }
  };
};
