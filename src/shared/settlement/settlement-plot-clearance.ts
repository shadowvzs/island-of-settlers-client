import type { SettlementBuilding } from "./settlement-types";

/** Exact reserved plot cells, also queried with body clearance by wildlife navigation. */
export const createBuildingPlotMask = (cellsX: number, cellsZ: number) => {
  const cells = new Uint8Array(cellsX * cellsZ);
  const add = (building: Pick<SettlementBuilding, "x" | "z" | "width" | "depth">) => {
    for (let z = building.z - building.depth / 2; z < building.z + building.depth / 2; z++)
      for (let x = building.x - building.width / 2; x < building.x + building.width / 2; x++)
        cells[z * cellsX + x] = 1;
  };
  const contains = (x: number, z: number, margin = 0) => {
    const minX = Math.max(0, Math.floor(x - margin)),
      minZ = Math.max(0, Math.floor(z - margin));
    const maxX = Math.min(cellsX - 1, Math.floor(x + margin));
    const maxZ = Math.min(cellsZ - 1, Math.floor(z + margin));
    for (let row = minZ; row <= maxZ; row++)
      for (let column = minX; column <= maxX; column++)
        if (cells[row * cellsX + column]) return true;
    return false;
  };
  const remove=(building:Pick<SettlementBuilding,"x"|"z"|"width"|"depth">) => {
    for(let z=building.z-building.depth/2;z<building.z+building.depth/2;z++)
      for(let x=building.x-building.width/2;x<building.x+building.width/2;x++) cells[z*cellsX+x]=0;
  };
  /** Exactly the plots of `buildings` (a load or snapshot reload). */
  const reset = (buildings: readonly Pick<SettlementBuilding, "x" | "z" | "width" | "depth">[]) => {
    cells.fill(0);
    for (const building of buildings) add(building);
  };
  return { add, contains, remove, reset };
};
