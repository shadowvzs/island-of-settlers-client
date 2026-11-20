import { acceptedAdventureCampLayout } from "./adventure-camp-layout";
import { type CampObstacleIndex,createCampObstacleIndex } from "./adventure-camp-obstacles";
import type { SettlementContext } from "./settlement-types";

interface NavigationCache {
  epoch: number; build: number; terrain: number; props: number; index: CampObstacleIndex;
}
const caches = new WeakMap<SettlementContext, NavigationCache>();
/** Actor queries never regenerate layouts or scan every camp; one cell returns nearby shells only. */
export const adventureCampNavigationIndex = (context: SettlementContext) => {
  const world = context.options.world;
  const epoch = context.adventure?.campRevision?.() ?? 0;
  const build = world.buildRevision ?? 0, terrain = world.terrainRevision ?? 0, props = world.props.count;
  const previous = caches.get(context);
  if (previous?.epoch === epoch && previous.build === build && previous.terrain === terrain && previous.props === props)
    return previous.index;
  const frames = context.adventure?.campFrames?.() ?? [];
  const index = createCampObstacleIndex(world.cellsX, acceptedAdventureCampLayout(world, frames).obstacles);
  caches.set(context, { epoch, build, terrain, props, index }); return index;
};
