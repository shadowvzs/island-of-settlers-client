import { createCamera } from "../../render-common/camera-state";
import type { TerrainRenderer } from "../../render-common/renderer-contract";
import { createIslandNav } from "../../render-common/wildlife/nav/island-nav";
import type { LoadedGameSave } from "../../shared/settlement/game-save";
import { createIslandAnimals } from "../island-animals";
import { createIslandFelling } from "../island-felling";
import { createIslandGrowth } from "../island-growth";
import { removeHarvestedTree } from "../island-tree-removal";
import type { GameRuntimeState } from "./game-session";
import { createIslandResources } from "./island-resource-hooks";

/**
 * The normal resource managers without a canvas, renderer, audio or view-dependent work; wildlife, growth and
 * felling step inside the settlement ticks (`onTickStart`) on the island's absolute tick time.
 */
export const createOfflineIslandRuntime = (
  loaded: LoadedGameSave, options: { treeGrowthMasked?: boolean | (() => boolean) } = {}
) => {
  const { world } = loaded.map;
  world.buildRevision ??= 0;
  const saved = loaded.runtime as GameRuntimeState | undefined;
  const camera = createCamera(world.start.x, world.start.z, .2);
  const animals = createIslandAnimals(world, createIslandNav(world, []), saved?.animals, [],
    { isMatureTree: id => felling.isStanding(id) && !growth.isGrowing(id) });
  const growth = createIslandGrowth(world, id => felling.isStanding(id));
  growth.onGrown(animals.manager.onTreeGrown);
  const felling = createIslandFelling({ camera, world, canFell: id => !growth.isGrowing(id),
    isGrown: growth.isGrown, onFelled: animals.onTreeFelled,
    // As the client's island homes do: the habitat around a removed stump follows the world.
    onRemoved: id => {
      const region = removeHarvestedTree(world, {} as TerrainRenderer, id);
      growth.remove([id]);
      if (region) animals.manager.refreshHomes(region, { added: [], removed: [id] });
    },
    project: () => ({ x: 0, y: 0, depth: 0 }) });
  if (saved) { growth.loadState(saved.growth); felling.loadState(saved.felling); }
  const { hooks, saveStoneLedger } = createIslandResources({ world, animals, growth, felling,
    renderer: {} as TerrainRenderer, savedStone: saved?.stone, treeGrowthMasked: options.treeGrowthMasked });
  return {
    hooks,
    treeGrowth: {
      nextBoundary: growth.nextBoundary,
      revision: growth.frame.revision,
      setNow: growth.setNow,
      update: growth.update
    },
    livingAnimals: () => animals.manager.countAlive(),
    /** A skip's felling: the trees leave their wildlife region as a finished harvest does. */
    fellTrees: (ids: readonly number[]) => {
      for (const id of ids) animals.manager.onTreeFelled(id);
      felling.removeTrees(ids, false);
      for (const id of ids) removeHarvestedTree(world, {} as TerrainRenderer, id);
      growth.remove(ids);
    },
    /** After an offline skip: growth and felling jump to the island's new absolute time (`tickSeconds`). */
    jumpTo: (time: number) => {
      growth.update(time); felling.advance(time);
    },
    save: () => ({ ...saved, camera: saved?.camera ?? camera, animals: animals.manager.saveState(), growth: growth.saveState(),
      felling: felling.saveState(), stone: saveStoneLedger() })
  };
};
