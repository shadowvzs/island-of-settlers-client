import { refreshCanopyField } from "../../render-common/canopy-field";
import { listRegionChunks } from "../../render-common/terrain-chunks";
import { tickSeconds } from "../../shared/settlement/game-clock";
import type { SettlementOptions } from "../../shared/settlement/settlement-types";
import { placeProp } from "../../shared/world/editing/prop-placement";
import { removePropsAt } from "../../shared/world/editing/prop-removal";
import { createPlantedTreeSpecies, isTreePlantingTerrain } from "../../shared/world/editing/tree-planting";
import { explainWorldNavigationChange, propTileRect } from "../../shared/world/navigation-change-log";
import { bumpBuildRevision } from "../../shared/world/save/world-change-journal";
import { PROP } from "../../shared/world/world-data";
import { createIslandBuildingClearance, type IslandHooksOptions } from "./island-building-clearance";
import { isLivingIslandAnimal } from "./island-hunting-targets";
import { createIslandMineHooks } from "./island-mine-hooks";
import { createIslandScriptNature } from "./island-script-nature";
import { createIslandStoneDeposits } from "./island-stone-deposits";
import type { IslandStoneLedgerState } from "./island-stone-ledger";

type IslandResourceHooks = Pick<
  SettlementOptions,
  "onFellTree" | "getFelledTreeProgress" | "getFelledTreePhase" | "canHarvestTree" | "onPlantTree" | "resourceTargets" |
  "consumeResource" | "stoneSources" | "getHuntTarget" | "hitHuntTarget" | "onSurveyDeposit" | "onOreChanged" | "onBuildingPlanned" |
  "onBuildingDemolished" | "onBuildingsRestored" | "onFoundationLeveled" | "onRoadGroundLeveled" | "onTalentsChanged" |
  "onBoulderRespawned" |
  "onTickStart" | "randomStreams" | "countHuntableAnimals" | "scriptNature"
>;
interface IslandResourceOptions extends IslandHooksOptions {
  /** The event core owns tree growth; the fixed onTickStart still advances felling and wildlife. */
  treeGrowthMasked?: boolean | (() => boolean);
  /** The saved quarry amounts, so a worked boulder or seam stays worked after a reload. */
  savedStone?: IslandStoneLedgerState;
}

const cellOf = (world: IslandHooksOptions["world"], id: number) => {
  const x = Math.floor(world.props.x[id]!), z = Math.floor(world.props.z[id]!);
  return { minX: x, maxX: x, minZ: z, maxZ: z };
};

type PlantingPoint = Parameters<NonNullable<SettlementOptions["onPlantTree"]>>[0];

/**
 * A planted tree's look follows its spot, not a running count: an unsaved counter would give a resumed island
 * different trees than continuous play (snapshot fidelity, D3).
 */
const plantedTreeSeed = (seed: number, point: { x: number; z: number }) =>
  seed + Math.round(point.x * 977 + point.z * 7919);

const createIslandResourceHooks = (
  options: IslandResourceOptions,
  stone: ReturnType<typeof createIslandStoneDeposits>
): IslandResourceHooks => {
  const { animals, felling, growth, renderer, world } = options;
  const firstPlacedProp = world.props.count;
  const plantedSpecies = createPlantedTreeSpecies(world);
  const mature = (id: number) => felling.isStanding(id) && !growth.isGrowing(id);
  const alive = (id: number) => isLivingIslandAnimal(animals.manager, id);
  const { manager } = animals;
  const clearance=createIslandBuildingClearance(options);
  const plantTree = (point: PlantingPoint) => {
    let kind: number;
    if (point.treeSpecies) kind = PROP[point.treeSpecies];
    else kind = plantedSpecies(point.x, point.z);
    const id = placeProp(world, {
      ...point,
      kind,
      seed: plantedTreeSeed(world.seed, point)
    });
    if (typeof id !== "number") return false;
    felling.addTrees([id]);
    growth.plant(id);
    const region = {
      minX: Math.max(0, Math.floor(point.x) - 3),
      minZ: Math.max(0, Math.floor(point.z) - 3),
      maxX: Math.min(world.cellsX - 1, Math.floor(point.x) + 3),
      maxZ: Math.min(world.cellsZ - 1, Math.floor(point.z) + 3)
    };
    refreshCanopyField(world, region);
    renderer.mapEdit?.refreshPlacedProps(firstPlacedProp);
    renderer.mapEdit?.refreshChunks(listRegionChunks(world, region), false);
    bumpBuildRevision(world, null);
    return true;
  };
  return {
    stoneSources: stone,
    onBuildingPlanned: clearance,
    onFoundationLeveled: clearance.levelled,
    onRoadGroundLeveled: clearance.roadLevelled,
    onBuildingDemolished: clearance.demolish,
    onBuildingsRestored: clearance.restored,
    ...createIslandMineHooks(world, renderer),
    // Wildlife, growth and felling step on the settlement tick: neither the camera nor the frame rate changes
    // them, and a reload continues the same absolute tick time.
    onTickStart: (_dt, tick) => {
      const time = tickSeconds(tick);
      const masked = typeof options.treeGrowthMasked === "function"
        ? options.treeGrowthMasked() : options.treeGrowthMasked === true;
      if (!masked) growth.update(time);
      felling.advance(time);
      animals.manager.step();
    },
    randomStreams: [animals.manager.random, felling.random],
    // The map script's view of the wildlife and tree growth that step above (TRG3b; inert without a script).
    scriptNature: createIslandScriptNature(animals, growth),
    canHarvestTree: mature,
    // The simulation restored the prop; the boulder is full again and grows back in.
    onBoulderRespawned: id => {
      stone.refillProp(id);
      renderer.mapEdit?.growProps?.([id], cellOf(world, id));
    },
    // Trees grow faster with the player's tree growth talent (TALENT-01).
    onTalentsChanged: talents => growth.setSpeed(1 + talents.treeGrowthSpeed),
    getFelledTreePhase: felling.getPhase,
    getFelledTreeProgress: felling.getWorkProgress,
    onFellTree: (id, rate) => {
      if (!mature(id)) return false;
      return felling.fell(id, rate);
    },
    onPlantTree: (point) => {
      if (!isTreePlantingTerrain(world, point.x, point.z)) return false;
      const tile = { maxX: Math.floor(point.x), maxZ: Math.floor(point.z), minX: Math.floor(point.x),
        minZ: Math.floor(point.z) };
      // A sapling changes navigation only on its own tile (walk cost and trunk bucket; journal, A03).
      return explainWorldNavigationChange(world, tile, () => plantTree(point));
    },
    // A hunter's scan wakes the wildlife regions it searches (simulation event, never the camera).
    resourceTargets: (kind, near, range) => {
      if (kind === "stone") return stone.targets(near, range);
      if (kind !== "wildlife" && kind !== "carcass") return undefined;
      return manager.listHuntTargets(kind, near, range);
    },
    // Read-only (tutorial checks from the UI): dormant animals count, nothing wakes.
    countHuntableAnimals: manager.countHuntable,
    getHuntTarget: id => {
      manager.ensureSimulated(id);
      const { pool } = manager.debug;
      if (!pool.carcass[id] && (!alive(id) || !manager.isHuntable(id))) return null;
      return { x: pool.x[id]!, z: pool.z[id]!, fleeing: pool.huntState[id] === 1,
        dead: Boolean(pool.carcass[id]), collectible: manager.isCarcass(id) };
    },
    hitHuntTarget: manager.hitHuntedAnimal,
    consumeResource: (target) => {
      if (target.kind === "stone") return stone.consume(target);
      if (target.kind === "carcass") return animals.manager.harvestCarcass(target.id);
      if (target.kind !== "wildlife") return undefined;
      return animals.manager.harvestCarcass(target.id);
    }
  };
};

/** Outdoor jobs change the same living forest and wildlife the island already renders. */
export const createIslandResources = (options: IslandResourceOptions): {
  hooks: IslandResourceHooks;
  saveStoneLedger: () => IslandStoneLedgerState;
} => {
  // A worked out boulder changes navigation only on its own tile (journal, A03).
  const stone = createIslandStoneDeposits(options.world, id => explainWorldNavigationChange(options.world,
    propTileRect(options.world, id), () => {
      removePropsAt(options.world, [id]);
      options.renderer.mapEdit?.removeProps([id], cellOf(options.world, id));
      bumpBuildRevision(options.world, null);
    }), options.savedStone);
  return { hooks: createIslandResourceHooks(options, stone), saveStoneLedger: stone.saveState };
};
