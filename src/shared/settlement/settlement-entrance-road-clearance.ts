import { isOpenArcherTower } from "../../render-common/buildings/bandit-camp-plan";
import { DMath } from "../math/deterministic-math";
import { removePropsAt } from "../world/editing/prop-removal";
import { bumpBuildRevision } from "../world/save/world-change-journal";
import { BLOCKING, PROP_REMOVED } from "../world/world-data";
import { ROAD_RESERVED_HALF_WIDTH } from "./road-types";
import { hasEconomy, ownerOf } from "./settlement-ownership";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** The first outward road step must fit the full reserved stone width, including its end cap. */
export const entranceRoadCells = (context: SettlementContext, building: SettlementBuilding) => {
  if (isOpenArcherTower(building)) return [];
  const angle = building.rotation * Math.PI / 2;
  const dx = Math.round(DMath.sin(angle)), dz = Math.round(DMath.cos(angle));
  const cells = new Set<number>();
  for (const along of [0, .25, .5]) for (const side of [-1, 0, 1]) {
    const x = Math.floor(building.access.x + dx * along + dz * side * ROAD_RESERVED_HALF_WIDTH);
    const z = Math.floor(building.access.z + dz * along - dx * side * ROAD_RESERVED_HALF_WIDTH);
    if (x < 0 || z < 0 || x >= context.options.world.cellsX || z >= context.options.world.cellsZ) continue;
    cells.add(z * context.options.world.cellsX + x);
  }
  return [...cells];
};

export const clearEntranceRoadProps = (context: SettlementContext, building: SettlementBuilding) => {
  const { world } = context.options;
  const cells = new Set(entranceRoadCells(context, building));
  const removed: number[] = [];
  for (let id = 0; id < world.props.count; id++) {
    if (world.props.types[id] === PROP_REMOVED) continue;
    const cell = Math.floor(world.props.z[id]!) * world.cellsX + Math.floor(world.props.x[id]!);
    if (cells.has(cell)) removed.push(id);
  }
  building.clearedProps ??= [];
  building.clearedProps.push(...removed.map(index => ({ index, type: world.props.types[index]! })));
  removePropsAt(world, removed);
  return removed;
};

/**
 * Repairs only unfinished sites of a faction with an economy (the player's, or an economy AI's) whose
 * old placement left vegetation sealing the entrance; hostile sites of `none` factions stay untouched.
 */
export const repairEntranceRoadClearance = (context: SettlementContext) => {
  for (const building of context.buildings) {
    if (building.construction === 1 || !hasEconomy(context, ownerOf(building))) continue;
    if (!entranceRoadCells(context, building).some(cell => context.options.world.blocking[cell] === BLOCKING.prop)) continue;
    const removed = clearEntranceRoadProps(context, building);
    if (!removed.length) continue;
    bumpBuildRevision(context.options.world, null);
    context.options.onBuildingPlanned?.(building, removed);
  }
};
