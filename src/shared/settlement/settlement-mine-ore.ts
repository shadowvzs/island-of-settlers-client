import { markWorldCellChanged } from "../world/save/world-change-journal";
import { ORE, type WorldData } from "../world/world-data";

type MineFootprint = { depth: number; typeId: number; width: number; x: number; z: number };

const MINE_ORES = [ORE.granite, ORE.coal, ORE.iron, ORE.gold];

/** The mine's own ore cells with ore left, in its digging (scan) order. */
const mineOreCells = function* (world: WorldData, building: MineFootprint) {
  const requiredOre = MINE_ORES[building.typeId - 10];
  for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
    for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++) {
      const cell = z * world.cellsX + x;
      if (!world.oreAmount[cell]) continue;
      const zone = world.mineZones.find((entry) => entry.id === world.mineZone[cell]);
      if (zone?.ore === requiredOre) yield cell;
    }
};

/** The footprint cell a mine digs next; -1 when its own ore is worked out. */
export const mineOreCell = (world: WorldData, building: MineFootprint) => {
  for (const cell of mineOreCells(world, building)) return cell;
  return -1;
};

/** Ore the mine can still dig from its own footprint. */
export const mineOreLeft = (world: WorldData, building: MineFootprint) => {
  let left = 0;
  for (const cell of mineOreCells(world, building)) left += world.oreAmount[cell]!;
  return left;
};

/** Digs `count` ore in the mine's own order; returns the changed cells. */
export const digMineOre = (world: WorldData, building: MineFootprint, count: number) => {
  const changed: number[] = [];
  let remaining = count;
  for (const cell of mineOreCells(world, building)) {
    if (remaining <= 0) break;
    const taken = Math.min(remaining, world.oreAmount[cell]!);
    world.oreAmount[cell] = world.oreAmount[cell]! - taken;
    markWorldCellChanged(world, cell);
    remaining -= taken;
    changed.push(cell);
  }
  return changed;
};
