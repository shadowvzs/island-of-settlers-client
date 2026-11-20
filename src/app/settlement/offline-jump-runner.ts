import { getBuildingProductionRule } from "../../shared/settlement/production-rules";
import { mineOreLeft } from "../../shared/settlement/settlement-mine-ore";
import { buildingGoods, storedGoods, workedResources } from "../../shared/settlement/settlement-offline-ledger";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import { islandStorageCapacity, storageRoom } from "../../shared/settlement/storage-capacity";
import type { WorldData } from "../../shared/world/world-data";
import { jumpFlows } from "./offline-flow-jump";
import type { FlowModel } from "./offline-flow-model";
import { applyJump, moveGoods } from "./offline-jump-apply";
import type { Counts } from "./offline-ledger-flow";
import { fellableTrees, WOODCUTTER } from "./offline-tree-harvest";

/** Shorter jumps are not worth it. */
const MIN_JUMP_SECONDS = 60;

/** A completed workshop without a worker: the next idle settler staffs it (a structure change). */
const hasUnstaffedWorkshop = (simulation: SettlementSimulation) => simulation.buildings().some(building => {
  const rule = getBuildingProductionRule(building, simulation.playerNation());
  return building.construction === 1 && !!rule && !rule.service && building.worker === undefined;
});

/** A measured island: its chains, births per second and its colony's steady draw on the home stock. */
export interface JumpPlan {
  births: number;
  homeDraw: Counts;
  model: FlowModel;
  people: number;
}

export interface JumpRunnerOptions {
  canHarvestTree: (id: number) => boolean;
  fellTrees: (ids: readonly number[]) => void;
  homeBuildings: () => SettlementBuilding[] | undefined;
  livingAnimals: () => number;
  onOreChanged?: (cell: number) => void;
  produced: (ware: string) => void;
  simulation: SettlementSimulation;
  world: WorldData;
}

/** A jump ends before the home island runs out of something a colony draws on: that is real ticked. */
const homeLimit = (draw: Counts, stock: Counts) => Object.entries(draw).reduce((limit, [ware, rate]) =>
  rate < 0 ? Math.min(limit, (stock[ware] ?? 0) / -rate) : limit, Infinity);

/** Runs analytic jumps on the island's current stocks, sources and storages. */
export const createJumpRunner = (options: JumpRunnerOptions) => {
  const { simulation, world } = options;

  const fellable = (key: string) => {
    const woodcutter = key === "~tree" ? WOODCUTTER : Number(key.slice("~tree:".length));
    return fellableTrees(world, simulation.buildings(), simulation.frames(), options.canHarvestTree, woodcutter);
  };

  /** Units on hand per key: goods in buildings, a mine's ore, fellable trees, game; sources are renewable. */
  const stockOf = (goods: Counts, trees: Map<string, readonly number[]>) => (key: string) => {
    if (!key.startsWith("~")) return goods[key] ?? 0;
    if (key.startsWith("~ore:")) {
      const mine = simulation.buildings().find(building => `~ore:${building.uid}` === key);
      return mine ? mineOreLeft(world, mine) : 0;
    }
    if (key.startsWith("~tree")) {
      if (!trees.has(key)) trees.set(key, fellable(key));
      return trees.get(key)!.length;
    }
    return key === "~animal" ? options.livingAnimals() : Infinity;
  };

  const birthRoom = () => {
    const { limit, people } = simulation.population();
    if (limit === undefined) return Infinity;
    const staffing = simulation.availableSettlers() === 0 && hasUnstaffedWorkshop(simulation);
    return Math.min(limit - people, staffing ? 1 : Infinity);
  };

  const prepare = (plan: JumpPlan, limit: number) => {
    const home = options.homeBuildings();
    const seconds = Math.min(limit, home ? homeLimit(plan.homeDraw, storedGoods(home)) - MIN_JUMP_SECONDS : limit);
    if (seconds < MIN_JUMP_SECONDS) return undefined;
    const buildings = simulation.buildings(), trees = new Map<string, readonly number[]>();
    const capacity = islandStorageCapacity(buildings, simulation.talentModifiers().storageCapacity);
    const result = jumpFlows(plan.model, { births: { rate: plan.births, room: birthRoom() },
      calibrationPeople: plan.people, people: simulation.population().people, populationStep: 10,
      room: key => key.startsWith("~") ? Infinity : storageRoom(capacity, key),
      seconds, stock: stockOf(buildingGoods(buildings), trees) });
    return { home, result };
  };

  return {
    preview: (plan: JumpPlan, limit: number) => prepare(plan, limit)?.result,
    run: (plan: JumpPlan, limit: number) => {
      const prepared = prepare(plan, limit);
      if (!prepared) return { grown: false, seconds: 0 };
      const { home, result } = prepared;
      applyJump(plan.model, result, { fellTrees: options.fellTrees,
        fellable: key => fellable(key), onOreChanged: options.onOreChanged, produced: options.produced, simulation,
        sources: workedResources(simulation.saveState()).left, world });
      if (home) moveGoods(home, Object.fromEntries(Object.entries(plan.homeDraw)
        .map(([ware, rate]) => [ware, rate * result.seconds])));
      return { grown: result.grown, seconds: result.seconds };
    }
  };
};
