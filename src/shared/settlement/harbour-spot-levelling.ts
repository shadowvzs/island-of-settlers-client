import { removePropsAt } from "../world/editing/prop-removal";
import { writeSplatWeights } from "../world/ground-buffer";
import { rebakeTerrainLight } from "../world/lighting";
import { HEIGHT_LEVEL_STEP, MATERIAL_COUNT, PROP_REMOVED, type WorldData } from "../world/world-data";
import { refreshFoundationTerrain } from "./settlement-foundation";
import type { SettlementBuilding } from "./settlement-types";

/** Plot margin the runtime levelling checks (settlement-foundation `LEVEL_MARGIN`). */
const LEVEL_MARGIN = 1;
/**
 * Generation apron (cells): twice the runtime three-cell apron, so the levelled shelf meets the
 * beach in a gentle slope rather than a steep rim that reads as a grey sand/rock band.
 */
const SPOT_APRON = 6;
/**
 * Apron vertices this low stay untouched: raising the waterline would push the beach seawards and
 * cut the shore workpoint/berth the spot was proven with.
 */
const WATERLINE_KEEP = .35;
/** Height change (units) at which an apron vertex takes the full inland ground material. */
const FULL_REPAINT_CHANGE = .3;

const plotDistance = (building: SettlementBuilding, x: number, z: number) =>
  Math.max(Math.abs(x - building.x) - building.width / 2, Math.abs(z - building.z) - building.depth / 2, 0);

const apronBlend = (distance: number) => {
  const cover = Math.max(0, 1 - Math.max(0, distance - LEVEL_MARGIN) / (SPOT_APRON - LEVEL_MARGIN));
  return cover * cover * (3 - 2 * cover);
};

/** Ground material weights at the vertex nearest the plot's entrance (the inland, door side). */
const inlandGround = (world: WorldData, building: SettlementBuilding) => {
  const vertex = Math.round(building.access.z) * (world.cellsX + 1) + Math.round(building.access.x);
  return Float32Array.from({ length: MATERIAL_COUNT }, (_, material) =>
    world.splat[vertex * MATERIAL_COUNT + material]!);
};

/** Moves one vertex's ground material towards the inland ground by `amount` (0..1). */
const repaint = (world: WorldData, vertex: number, inland: Float32Array, amount: number, weights: Float32Array) => {
  for (let material = 0; material < MATERIAL_COUNT; material++) {
    const current = world.splat[vertex * MATERIAL_COUNT + material]!;
    weights[material] = current + (inland[material]! - current) * amount;
  }
  writeSplatWeights(world.splat, vertex, weights);
};

/**
 * Props (trees, reeds, rocks) this far around the plot are cleared, like the reserved island ground:
 * the plot, its entrance road and the build-class prop clearance stay free.
 */
const PROP_CLEAR_MARGIN = 3;

const clearSpotProps = (world: WorldData, building: SettlementBuilding) => {
  const { props } = world, removed: number[] = [];
  const halfWidth = building.width / 2 + PROP_CLEAR_MARGIN, halfDepth = building.depth / 2 + PROP_CLEAR_MARGIN;
  for (let index = 0; index < props.count; index++) {
    if (props.types[index] === PROP_REMOVED) continue;
    if (Math.abs(props.x[index]! - building.x) <= halfWidth && Math.abs(props.z[index]! - building.z) <= halfDepth)
      removed.push(index);
  }
  removePropsAt(world, removed);
};

/**
 * Plot level of a shore spot: just above its lowest dry corner (never below the quay minimum), so the
 * plot is cut into the rising ground behind it instead of raised over the beach. Raising it to the
 * centre height left a shelf whose seaward edge became a rock wall above the kept waterline.
 * Any level works for the runtime check: a flat plot samples to its own height.
 */
const QUAY_ABOVE_LOWEST = .15;
const QUAY_MINIMUM = .2;
const quayHeight = (world: WorldData, building: SettlementBuilding) => {
  let lowest = Infinity;
  const left = building.x - building.width / 2, top = building.z - building.depth / 2;
  for (let z = top; z <= top + building.depth; z++) for (let x = left; x <= left + building.width; x++) {
    const vertex = z * (world.cellsX + 1) + x;
    if ((world.waterDepth[vertex] ?? 0) <= 0) lowest = Math.min(lowest, world.heights[vertex]!);
  }
  return Math.fround(Math.max(world.seaLevel + QUAY_MINIMUM, lowest + QUAY_ABOVE_LOWEST));
};

export interface SpotLevelling {
  bounds: { maxX: number; maxZ: number; minX: number; minZ: number };
  highestBefore: number;
}

const levellingBounds = (world: WorldData, building: SettlementBuilding) => ({
  maxX: Math.min(world.cellsX, Math.ceil(building.x + building.width / 2 + SPOT_APRON)),
  maxZ: Math.min(world.cellsZ, Math.ceil(building.z + building.depth / 2 + SPOT_APRON)),
  minX: Math.max(0, Math.floor(building.x - building.width / 2 - SPOT_APRON)),
  minZ: Math.max(0, Math.floor(building.z - building.depth / 2 - SPOT_APRON))
});

/**
 * HARBOUR-SPOTS: levels a candidate spot at generation exactly as the runtime foundation would (plot
 * and one-vertex margin at the plot height, dry vertices only), so claiming it later changes nothing.
 * The wider apron eases into the shore, keeps the waterline and takes the inland ground material
 * where it moved, which avoids the decoloured beach shelf of a runtime-levelled coastal foundation.
 * Terrain light is left to `relightHarbourSpots` once the spots are final.
 */
export const preLevelHarbourSpot = (world: WorldData, building: SettlementBuilding): SpotLevelling => {
  const height = quayHeight(world, building);
  building.y = height;
  const bounds = levellingBounds(world, building);
  const inland = inlandGround(world, building), weights = new Float32Array(MATERIAL_COUNT);
  let highestBefore = -Infinity;
  clearSpotProps(world, building);
  for (let z = bounds.minZ; z <= bounds.maxZ; z++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
    const vertex = z * (world.cellsX + 1) + x;
    const distance = plotDistance(building, x, z), blend = apronBlend(distance);
    if (blend <= 0 || (world.waterDepth[vertex] ?? 0) > 0) continue;
    const before = world.heights[vertex]!;
    if (distance > LEVEL_MARGIN && before < world.seaLevel + WATERLINE_KEEP) continue;
    // Exactly the plot height inside the margin: the runtime levelled-plot check compares equality.
    const after = blend >= 1 ? height : Math.fround(before + (height - before) * blend);
    highestBefore = Math.max(highestBefore, before);
    world.heights[vertex] = after;
    world.heightLevels[vertex] = Math.max(0, Math.floor((after + .5) / HEIGHT_LEVEL_STEP));
    const repaintAmount = distance <= LEVEL_MARGIN ? 1 :
      blend * Math.min(1, Math.abs(after - before) / FULL_REPAINT_CHANGE);
    if (repaintAmount > 0) repaint(world, vertex, inland, repaintAmount, weights);
  }
  refreshFoundationTerrain(world, bounds);
  return { bounds, highestBefore };
};

/** Rows a levelling and its refresh margin can write, per layer (vertex rows or cell rows). */
const capturedRows = (world: WorldData, building: SettlementBuilding) => {
  const bounds = levellingBounds(world, building);
  return { first: Math.max(0, bounds.minZ - 2), last: Math.min(world.cellsZ, bounds.maxZ + 2) };
};

/** Saves every layer a trial levelling writes; the returned function puts them back. */
export const captureSpotTerrain = (world: WorldData, building: SettlementBuilding) => {
  const { first, last } = capturedRows(world, building);
  const vertexRow = world.cellsX + 1, cellRow = world.cellsX;
  const layers: Array<[ArrayLike<number> & { set(values: ArrayLike<number>, offset: number): void;
    slice(start: number, end: number): ArrayLike<number> }, number]> = [
    [world.heights, vertexRow], [world.heightLevels, vertexRow], [world.splat, vertexRow * MATERIAL_COUNT],
    [world.normals, vertexRow * 3], [world.slopeClass, cellRow], [world.blocking, cellRow],
    [world.walkCost, cellRow], [world.buildClass, cellRow]
  ];
  const saved = layers.map(([layer, row]) => {
    const start = first * row, end = Math.min(layer.length, (last + 1) * row);
    return { copy: layer.slice(start, end), layer, start };
  });
  const propTypes = world.props.types.slice();
  return () => {
    for (const { copy, layer, start } of saved) layer.set(copy, start);
    world.props.types.set(propTypes);
  };
};

/** Re-bakes terrain light over every kept spot (shadows may reach beyond the levelled area). */
export const relightHarbourSpots = (world: WorldData, levellings: readonly SpotLevelling[]) => {
  for (const { bounds, highestBefore } of levellings)
    rebakeTerrainLight(world, world.heights, world.waterSurface, world.sun, bounds, world, highestBefore);
};
