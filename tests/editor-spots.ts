import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { BLOCKING, BUILD, SLOPE, type WorldData } from "../src/shared/world/world-data";

/**
 * A small island with plenty of open inland flats for the map editor tests. The seed is fixed
 * on purpose: which seed keeps room for every stamp changes when the generator changes.
 */
export const SMALL_EDITOR_WORLD = {
  ...DEFAULT_WORLD_OPTIONS,
  cellsX: 96,
  cellsZ: 96,
  erosionDroplets: 8000,
  seed: 1
};

/** Large building spots far from water, at least `spacing` cells apart (map editor tests). */
export const findOpenSpots = (world: WorldData, count: number, spacing: number) => {
  const spots: { x: number; z: number }[] = [];
  for (let cell = 0; cell < world.buildClass.length && spots.length < count; cell += 1) {
    const x = (cell % world.cellsX) + 0.5;
    const z = Math.floor(cell / world.cellsX) + 0.5;
    const vertex = Math.floor(z) * (world.cellsX + 1) + Math.floor(x);
    const isInland = world.coastDistance[vertex]! >= 12 && world.riverDistance[vertex]! >= 12;
    const isApart = spots.every((spot) => Math.hypot(spot.x - x, spot.z - z) >= spacing);
    if (world.buildClass[cell] === BUILD.large && isInland && isApart) spots.push({ x, z });
  }
  if (spots.length < count) throw new Error("not enough open spots");
  return spots;
};

type Spot = { x: number; z: number };

const canTakeProp = (world: WorldData, cellX: number, cellZ: number) => {
  const cell = cellZ * world.cellsX + cellX;
  return world.blocking[cell] === BLOCKING.free && world.slopeClass[cell] !== SLOPE.cliff;
};

/**
 * A spot (cell centre) where a tree or stone fits at every offset (cells), at least `spacing`
 * from the other spots: searched, so the map editor tests never rely on one island layout.
 */
export const findPropSpot = (
  world: WorldData,
  offsets: readonly (readonly [number, number])[],
  others: readonly Spot[],
  spacing: number
) => {
  for (let cell = 0; cell < world.blocking.length; cell += 1) {
    const cellX = cell % world.cellsX;
    const cellZ = Math.floor(cell / world.cellsX);
    const spot = { x: cellX + 0.5, z: cellZ + 0.5 };
    if (others.some((other) => Math.hypot(other.x - spot.x, other.z - spot.z) < spacing)) continue;
    const fits = offsets.every(([dx, dz]) => {
      const x = cellX + dx;
      const z = cellZ + dz;
      const isInside = x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ;
      return isInside && canTakeProp(world, x, z);
    });
    if (fits) return spot;
  }
  throw new Error("no spot for the props");
};
