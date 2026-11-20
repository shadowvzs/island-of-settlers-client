import { type CellRegion, isRegionEmpty } from "../../../shared/world/grid-geometry";
import type { NavWorld } from "../nav/nav-query";
import { ISLAND_ANIMAL_CAP, type TreeChanges } from "../population/wildlife-regions";
import { startAnimalDeparture } from "../sim/animal-appearance";
import { REFRESH_REACH, refreshHabitatField } from "../sim/animal-habitat";
import type { AnimalManagerState } from "./animal-manager-state";
import type { AnimalModes } from "./animal-modes";
import type { AnimalSpawner } from "./animal-spawner";

const growCells = (cells: CellRegion, reach: number): CellRegion => ({
  maxX: cells.maxX + reach, maxZ: cells.maxZ + reach, minX: cells.minX - reach, minZ: cells.minZ - reach
});

/**
 * The regions' homes: standing mature tree counters built from the world on the first step (and
 * after every load, never saved), kept in O(1) per felled, grown, placed or removed tree; the
 * first population; edits that leave a region with more animals than it supports send the
 * surplus away (fading out, highest slot first), felling does not (survivors stay).
 */
export const createAnimalHomes = (state: AnimalManagerState, modes: AnimalModes, spawner: AnimalSpawner) => {
  const { flags, identity, ledger, pool, regions, removed, world } = state;

  const isCountable = (id: number) => state.isTreeProp(id) && state.isMatureTree(id);

  const reconcileAll = () => {
    for (let region = 0; region < regions.count; region += 1) {
      ledger.reconcile(region, regions.target[region]!, regions.population[region]!, state.context.tick);
    }
  };

  /** First step (new island or load): counters from the world, then the population or the ledger. */
  const start = () => {
    if (flags.started) return;
    flags.started = true;
    regions.beginBulk();
    for (let id = 0; id < world.props.count; id += 1) if (isCountable(id)) regions.countTree(id);
    regions.endBulk();
    if (!flags.spawned) spawner.spawnInitialPopulation();
    flags.spawned = true;
    flags.reconciling = true;
    reconcileAll();
  };

  /** Living animals of the region above its target leave the island (edits only). */
  const evictSurplus = (region: number) => {
    let surplus = regions.population[region]! - regions.target[region]!;
    if (surplus <= 0) return;
    modes.touchRegion(region);
    for (let slot = ISLAND_ANIMAL_CAP - 1; slot >= 0 && surplus > 0; slot -= 1) {
      if (identity.homeRegion[slot] !== region || !pool.active[slot]) continue;
      startAnimalDeparture(pool, slot);
      state.releaseHome(slot);
      removed.emit(slot);
      surplus -= 1;
    }
  };

  /**
   * Map edits, building plots and levelled ground: the habitat and the species mix follow the
   * edited cells, removed trees leave their region and placed mature ones join theirs. It wakes
   * nothing by itself (a load re-derives terrain through it); a surplus to send away does.
   */
  const refresh = (cells: CellRegion, trees: TreeChanges, nav: NavWorld) => {
    refreshHabitatField(world, nav, state.field, cells);
    if (!isRegionEmpty(cells)) {
      regions.forEachRegionInCells(growCells(cells, REFRESH_REACH), spawner.invalidateHabitat);
    }
    if (!flags.started) return;
    const lost = new Set<number>();
    regions.beginBulk();
    for (const id of trees.removed) {
      const region = regions.uncountTree(id);
      if (region >= 0) lost.add(region);
    }
    for (const id of trees.added) if (isCountable(id)) regions.countTree(id);
    regions.endBulk();
    for (const region of [...lost].sort((a, b) => a - b)) evictSurplus(region);
  };

  return {
    /** Regions that are home to at least one animal. */
    countHomeRegions: () => regions.population.reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0),
    /** A tree was felled: its region counts one standing tree less (its animals stay). */
    onTreeFelled: (id: number) => {
      if (flags.started) regions.uncountTree(id);
    },
    /** A planted tree finished growing: its region counts one mature tree more. */
    onTreeGrown: (id: number) => {
      if (flags.started && isCountable(id)) regions.countTree(id);
    },
    refresh,
    start
  };
};
