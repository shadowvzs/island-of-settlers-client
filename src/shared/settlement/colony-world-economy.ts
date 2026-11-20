import { isTreePlantingTerrain } from "../world/editing/tree-planting";
import { BLOCKING, BUILD, PROP, SLOPE, type WorldData } from "../world/world-data";
import { reachableCells } from "./settlement-colony";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

const TIMBER = new Set<number>([PROP.broadleafTree, PROP.coniferTree, PROP.palmTree, PROP.birchTree,
  PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree]);

/** New themed colonies need an economy as well as forts; rejecting a candidate never edits a save. */
export const colonyWorldHasEconomy = (world: WorldData, home: SettlementPoint) => {
  const context = { options: { world }, buildings: [], occupied: new Uint8Array(world.cellsX * world.cellsZ) };
  const reachable = reachableCells(context as unknown as SettlementContext, home);
  let timber = 0, plantable = 0, cropGround = 0, oreApproaches = 0;
  for (let index = 0; index < world.props.count; index++) {
    if (TIMBER.has(world.props.types[index]!) && world.props.scale[index]! >= .7 &&
      reachable({ x: world.props.x[index]!, z: world.props.z[index]! })) timber++;
  }
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++) {
    const cell = z * world.cellsX + x, point = { x: x + .5, z: z + .5 };
    if (!reachable(point)) continue;
    if (isTreePlantingTerrain(world, point.x, point.z)) plantable++;
    if (world.walkCost[cell] && world.blocking[cell] === BLOCKING.free &&
      world.buildCap[cell]! >= BUILD.small && world.buildCap[cell]! <= BUILD.large &&
      world.slopeClass[cell]! <= SLOPE.gentle) cropGround++;
    if (world.mineZone[cell] && world.oreAmount[cell]) oreApproaches++;
  }
  return timber >= 15 && plantable >= 30 && cropGround >= 100 && oreApproaches >= 1;
};
