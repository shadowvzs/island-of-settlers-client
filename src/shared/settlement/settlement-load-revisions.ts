import { createTransientMap } from "./settlement-transient-state";
import type { SettlementContext } from "./settlement-types";

export interface SavedNavigationRevisions { build: number; roads: number;
  aliases?: import("./settlement-navigation-recovery").SavedNavigationRevisionAlias[] }
type RevisionBase = SavedNavigationRevisions;

const loadBases = createTransientMap<RevisionBase>();

/**
 * Raw counters restart differently in a fresh world and an in-place reload. Modern captures retain
 * their logical navigation epoch by adjusting these bases; absent historical metadata keeps the
 * existing since-load initialization. No topology, road tier or invalidation rule is changed.
 */
export const markLoadedRevisions = (context: SettlementContext, saved?: SavedNavigationRevisions) => {
  const { roads, world } = context.options;
  loadBases.set(context, { build: (world.buildRevision ?? 0) - (saved?.build ?? 0),
    roads: (roads.revision ?? 0) - (saved?.roads ?? 0) });
};

/** World build changes in the retained epoch (raw on an island that never loaded). */
export const buildRevisionSinceLoad = (context: SettlementContext) =>
  (context.options.world.buildRevision ?? 0) - (loadBases.get(context)?.build ?? 0);

/** Road changes in the retained epoch (raw on an island that never loaded). */
export const roadRevisionSinceLoad = (context: SettlementContext) =>
  (context.options.roads.revision ?? 0) - (loadBases.get(context)?.roads ?? 0);

/** Logical revision counts retain the same namespace across fresh and in-place restoration. */
export const saveNavigationRevisions = (context: SettlementContext): SavedNavigationRevisions => ({
  build: buildRevisionSinceLoad(context), roads: roadRevisionSinceLoad(context)
});
