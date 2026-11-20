import type { SharedContentBuilders } from "../render-common/content-builders";
import type { QualityPreset } from "../render-common/quality";
import { startIslandBuilds } from "../render-common/start-island-builds";
import type { WorkerNation } from "../render-common/workers/worker-unit";
import { enemyNationFor } from "../shared/settlement/enemy-nation";
import type { ColonyExpeditionSnapshot } from "../shared/settlement/settlement-colony-expeditions";
import type { AppParams } from "./app-params";
import { toIslandBuildGroup } from "./island-build-keys";
import { prepareIslandWorld, toIslandCacheGroup } from "./island-world-preparation";
import { createPoolBuilders } from "./pool-builders";
import { expeditionMapKey } from "./settlement/colony-boot";
import { prefetchVoyageAssets } from "./voyage-asset-prefetch";
import type { WorkerPool } from "./worker-pool";

interface Options {
  builders: SharedContentBuilders;
  fog: boolean;
  nation: WorkerNation;
  params: AppParams;
  pool: WorkerPool;
  quality: QualityPreset;
  revealOre: boolean;
}

/** One island at a time, with the worker pool's background concurrency limit. */
export const createIslandPregeneration = (options: Options) => {
  const started = new Set<number>();
  let active = false;
  let assetsActive = false;
  const assetsReady = new Set<string>();
  const enemyNations = new Map<number, string>();
  let assetsRetryAt = 0;
  let disposed = false;
  let suspended = false;
  let visited = new Set<number>();
  let expeditions: readonly ColonyExpeditionSnapshot[] = [];
  const unvisited = () => !disposed && !suspended &&
    expeditions.some(expedition => !visited.has(expedition.id));
  const warm = async (expedition: ColonyExpeditionSnapshot) => {
    const { builders, fog, nation, params, pool, quality, revealOre } = options;
    const group = toIslandCacheGroup(params, fog, revealOre, expeditionMapKey(expedition.island, expedition.id));
    const world = await pool.chartIsland(expedition.island, group);
    if (disposed || suspended || !world || visited.has(expedition.id) ||
      !expeditions.some(current => current.id === expedition.id)) return;
    // World choice may repair/retry the expedition seed; use the same final seed as rendering.
    enemyNations.set(expedition.id, enemyNationFor(nation, world.seed));
    if (!params.cache) return;
    prepareIslandWorld(world, params, fog, revealOre, nation);
    const islandBuilders = createPoolBuilders(pool, builders, world, toIslandBuildGroup(world));
    await Promise.all([...Object.values(startIslandBuilds(islandBuilders, quality)), islandBuilders.islandNav()]);
  };
  return {
    dispose: () => {
      disposed = true;
      suspended = false;
      started.clear();
      visited.clear();
      expeditions = [];
      enemyNations.clear();
      assetsReady.clear();
    },
    suspend: () => {
      if (!disposed) suspended = true;
    },
    update: (current: readonly ColonyExpeditionSnapshot[],
      records: readonly { expeditionId: number; landing?: unknown }[] = []) => {
      if (disposed || suspended) return;
      visited = new Set(records.filter(record => !record.landing).map(record => record.expeditionId));
      expeditions = current;
      const pendingEnemy = current.filter(expedition => !visited.has(expedition.id))
        .map(expedition => enemyNations.get(expedition.id)).find(nation => nation && !assetsReady.has(nation));
      const assetKey = pendingEnemy ?? options.nation;
      if (!assetsActive && !assetsReady.has(assetKey) && performance.now() >= assetsRetryAt && unvisited()) {
        assetsActive = true;
        void prefetchVoyageAssets(options.nation, !options.quality.liteGround, unvisited, pendingEnemy)
          .then(ready => {
            if (ready) assetsReady.add(assetKey);
            assetsRetryAt = ready ? 0 : performance.now() + 30_000;
          })
          .catch(error => {
            assetsRetryAt = performance.now() + 30_000;
            console.warn("Voyage manifests failed", error);
          })
          .finally(() => { assetsActive = false; });
      }
      if (active) return;
      const next = current.find(expedition => !started.has(expedition.id) && !visited.has(expedition.id));
      if (!next) return;
      started.add(next.id);
      active = true;
      void warm(next).catch(error => console.warn("Island voyage warming failed", error))
        .finally(() => { active = false; });
    }
  };
};
