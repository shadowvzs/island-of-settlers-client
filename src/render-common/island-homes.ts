import { type CellRegion,isRegionEmpty } from "../shared/world/grid-geometry";
import type { WorldData } from "../shared/world/world-data";
import type { BirdManager } from "./birds/bird-manager";
import type { ButterflyManager } from "./butterflies/butterfly-manager";
import type { CritterManager } from "./critters/critter-manager";
import { getTreeSpecies } from "./props/island-trees";
import type { AnimalManager } from "./wildlife/animal-manager";
import type { TreeChanges } from "./wildlife/population/wildlife-regions";

/** Where the island's animals live: every manager whose homes follow map edits. */
export interface IslandHomesOptions {
  animals: Pick<AnimalManager, "refreshHomes">;
  birds: Pick<BirdManager, "refreshHabitat">;
  butterflies: Pick<ButterflyManager, "refreshProps">;
  critters: Pick<CritterManager, "refreshHomes">;
  /** Whether a tree still stands (felled trees do not come back to a forest). */
  isTreeStanding: (tree: number) => boolean;
  world: WorldData;
}

/** Time of the homes refreshes (ms): the editor's performance numbers (Playwright). */
export interface HomesStats {
  lastMs: number;
  maxMs: number;
  refreshes: number;
}

/**
 * The animal homes after map edits (the same path for edits, undo / redo; a loaded map builds
 * them fresh): the props an edit placed, removed or brought back are noted as they change, then
 * `refresh` rebuilds the homes around the edited cells once the edit is rebuilt (after the
 * stroke, or after a terrain edit's rocks and navigation): bird habitat blocks, butterfly
 * flowers and obstacles, critter sites and rock cover, the wildlife's habitat and forests.
 */
export const createIslandHomes = (options: IslandHomesOptions) => {
  const { world } = options;
  const pendingProps = new Set<number>();
  const stats: HomesStats = { lastMs: 0, maxMs: 0, refreshes: 0 };

  const isStandingTree = (prop: number) =>
    prop < world.props.count &&
    getTreeSpecies(world.props.types[prop]!) !== undefined &&
    options.isTreeStanding(prop);

  /** The noted props by what they are now (sorted: the same edits give the same homes). */
  const takeTreeChanges = (): TreeChanges => {
    const props = [...pendingProps].sort((a, b) => a - b);
    pendingProps.clear();
    return {
      added: props.filter(isStandingTree),
      removed: props.filter((prop) => !isStandingTree(prop))
    };
  };

  const refresh = (cells: CellRegion) => {
    const propsChanged = pendingProps.size > 0;
    if (isRegionEmpty(cells) && !propsChanged) return;
    const started = performance.now();
    options.birds.refreshHabitat(cells);
    if (propsChanged) options.butterflies.refreshProps();
    options.critters.refreshHomes(cells);
    options.animals.refreshHomes(cells, takeTreeChanges());
    stats.lastMs = performance.now() - started;
    stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
    stats.refreshes += 1;
  };

  return {
    /** World props an edit placed, removed or brought back (trees, plants, stones). */
    noteProps: (props: readonly number[]) => {
      for (const prop of props) pendingProps.add(prop);
    },
    refresh,
    stats
  };
};
