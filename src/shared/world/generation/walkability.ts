import { getCellCount, type GridSize } from "../grid-geometry";
import { BLOCKING, MATERIAL, MATERIAL_COUNT, PROP, type PropSet,SLOPE } from "../world-data";

/** Walk cost units: 10 = open flat ground, 0 = impassable. */
export const WALK_COST = { blocked: 0, open: 10 } as const;

const SLOPE_COST = [0, 3, 9, 0];
const PROP_WALK_COST: Partial<Record<number, number>> = {
  [PROP.cedarTree]: 12,
  [PROP.walnutTree]: 12,
  [PROP.mahoganyTree]: 12,
  [PROP.hardwoodTree]: 12,
  [PROP.broadleafTree]: 12,
  [PROP.coniferTree]: 12,
  [PROP.palmTree]: 10,
  [PROP.birchTree]: 11,
  [PROP.bush]: 6,
  [PROP.smallRock]: 4,
  [PROP.reeds]: 4,
  [PROP.cattail]: 4,
  [PROP.riverShrub]: 6,
  [PROP.willowShrub]: 6,
  [PROP.sedge]: 2,
  [PROP.berryBush]: 6,
  [PROP.fern]: 2,
  [PROP.sapling]: 5,
  [PROP.broadleafShrub]: 4,
  [PROP.fieldShrub]: 4
};

const groundCost = (splat: Uint8Array, vertex: number) => {
  const weight = (material: number) => (splat[vertex * MATERIAL_COUNT + material] ?? 0) / 255;
  return weight(MATERIAL.sand) * 3 + weight(MATERIAL.forestFloor) * 2 + weight(MATERIAL.snow) * 6;
};

/** The layers a cell's walk cost is derived from (they live on the world). */
export interface WalkLayers extends GridSize {
  blocking: Uint8Array;
  slopeClass: Uint8Array;
  splat: Uint8Array;
}

/** Walk cost of a cell's terrain alone (slope, sand, forest floor, snow); 0 impassable. */
export const getGroundWalkCost = (layers: WalkLayers, cell: number) => {
  const { blocking, slopeClass } = layers;
  const terrainBlocked = blocking[cell] === BLOCKING.water || blocking[cell] === BLOCKING.cliff;
  if (terrainBlocked || slopeClass[cell] === SLOPE.cliff) return WALK_COST.blocked;
  const cellX = cell % layers.cellsX;
  const vertex = Math.floor(cell / layers.cellsX) * (layers.cellsX + 1) + cellX;
  return (
    WALK_COST.open + SLOPE_COST[slopeClass[cell]!]! + Math.round(groundCost(layers.splat, vertex))
  );
};

/** A prop standing in a cell of walk cost `cost`: large rocks wall it off, plants slow down. */
export const addPropWalkCost = (cost: number, type: number) => {
  if (cost === WALK_COST.blocked) return cost;
  if (type === PROP.largeRock) return WALK_COST.blocked;
  return Math.min(255, cost + (PROP_WALK_COST[type] ?? 0));
};

/**
 * Extra cost per cell for units (pathfinding): water, cliffs and large rocks are impassable;
 * slopes, forests, undergrowth, sand and snow are slower. Trees slow units down but do not wall
 * off forests (building is still blocked there through `blocking` / `buildClass`).
 */
export const createWalkCost = (
  grid: GridSize,
  slopeClass: Uint8Array,
  blocking: Uint8Array,
  splat: Uint8Array,
  props: PropSet
) => {
  const layers = { ...grid, blocking, slopeClass, splat };
  const cost = Uint8Array.from({ length: getCellCount(grid) }, (_, cell) =>
    getGroundWalkCost(layers, cell)
  );
  for (let index = 0; index < props.count; index += 1) {
    const cell = Math.floor(props.z[index]!) * grid.cellsX + Math.floor(props.x[index]!);
    cost[cell] = addPropWalkCost(cost[cell]!, props.types[index]!);
  }
  return cost;
};
