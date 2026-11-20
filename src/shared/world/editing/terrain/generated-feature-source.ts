import type { CellRegion } from "../../grid-geometry";
import type { WorldData } from "../../world-data";
import { addLakeProfile, collectReliefLakes } from "./generated-feature-relief-lakes";
import type { TerrainComponent } from "./terrain-component";

const WET = 0.01;

/** The level a lake selection is measured from: its single water surface (never the sea). */
const measureLakePlane = (world: WorldData, selection: TerrainComponent) => {
  const stride = world.cellsX + 1;
  const wet = selection.cells
    .flatMap((cell) => {
      const vertex = Math.floor(cell / world.cellsX) * stride + (cell % world.cellsX);
      return [vertex, vertex + 1, vertex + stride, vertex + stride + 1];
    })
    .find((index) => world.waterDepth[index]! > WET);
  if (wet === undefined) throw new Error("The selected lake has no wet terrain vertices.");
  const plane = world.waterSurface[wet]!;
  if (plane <= world.seaLevel + WET)
    throw new Error("Only isolated inland lakes can move; oceans remain fixed.");
  return plane;
};

/** Every vertex of the bounds that a selected cell touches. */
const touchedVertices = (world: WorldData, selection: TerrainComponent, bounds: CellRegion) => {
  const cells = new Set(selection.cells),
    stride = world.cellsX + 1,
    vertices: number[] = [];
  const selected = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < world.cellsX && z < world.cellsZ && cells.has(z * world.cellsX + x);
  for (let z = bounds.minZ; z <= bounds.maxZ + 1; z++)
    for (let x = bounds.minX; x <= bounds.maxX + 1; x++)
      if (selected(x - 1, z - 1) || selected(x, z - 1) || selected(x - 1, z) || selected(x, z))
        vertices.push(z * stride + x);
  return vertices;
};

/**
 * The measured profile of a selection: relief height above its contour, or lake depth below its
 * waterline. Still lakes standing on a relief join its profile (their beds may dip below it).
 */
export const measureFeatureSource = (
  world: WorldData,
  selection: TerrainComponent,
  bounds: CellRegion
) => {
  const lake = selection.kind === "water";
  const plane = lake ? measureLakePlane(world, selection) : selection.threshold;
  const source = new Map<number, number>(),
    wetSupport: number[] = [];
  for (const index of touchedVertices(world, selection, bounds)) {
    const height = world.heights[index]!;
    const amplitude = lake
      ? Math.max(0, world.waterSurface[index]! - height)
      : Math.max(0, height - plane);
    if (lake && amplitude > WET && Math.abs(world.waterSurface[index]! - plane) > 0.1)
      throw new Error("Select a single level lake without connected rivers.");
    if (!lake && world.waterDepth[index]! > WET) wetSupport.push(index);
    if (amplitude > 0.00001) source.set(index, amplitude);
  }
  const lakes = lake ? [] : collectReliefLakes(world, wetSupport, plane);
  addLakeProfile(world, lakes, source, plane);
  if (!source.size) throw new Error("The selected contour has no measurable terrain profile.");
  return { lake, lakes, plane, source };
};
