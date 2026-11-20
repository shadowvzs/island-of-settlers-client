import { getCellsRegion, type GridSize } from "../../grid-geometry";
import { MATERIAL_COUNT, PROP_REMOVED, type WorldData } from "../../world-data";
import { getVertexRangeCells } from "../brush";
import { assertSeedRestoreBoundary } from "./seed-restore-boundary";
import { seedRestoreProtectedVertices } from "./seed-restore-protection";
import { refreshEditedTerrain } from "./terrain-apply";
import { bakeTouchedStamps } from "./terrain-brush";
import type { TerrainEditState } from "./terrain-edit-state";

export interface TerrainRestoreSource {
  heights: Float32Array;
  waterSurface: Float32Array;
  lakeWater?: Uint8Array;
  flow?: Float32Array;
  seedBaseline?: true;
}

/** Explicit baseline provenance: never describes an old map as its original generated seed. */
export const captureTerrainRestoreBaseline = (world: WorldData, name: string) => {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("Name the captured terrain baseline first.");
  world.restoreBaselineName = clean;
  world.restoreBaselineHeights = Float32Array.from(world.heights);
  world.restoreBaselineWater = Float32Array.from(world.waterSurface);
  world.restoreBaselineLake = world.lakeWater ? Uint8Array.from(world.lakeWater) : new Uint8Array(world.heights.length);
};

/** Cells touching the restored vertices: the rebuild (and prop re-anchoring) stays where ground changed. */
const getRestoredCells = (grid: GridSize, vertices: readonly number[]) => {
  const stride = grid.cellsX + 1;
  const range = { maxX: -Infinity, maxZ: -Infinity, minX: Infinity, minZ: Infinity };
  for (const vertex of vertices) {
    const x = vertex % stride, z = Math.floor(vertex / stride);
    range.minX = Math.min(range.minX, x); range.maxX = Math.max(range.maxX, x);
    range.minZ = Math.min(range.minZ, z); range.maxZ = Math.max(range.maxZ, z);
  }
  return getVertexRangeCells(grid, range);
};

/** Restore only interior vertices of the exact selected cells. All current material paints survive. */
export const restoreTerrainSelection = (world: WorldData, state: TerrainEditState, selected: readonly number[],
  source?: TerrainRestoreSource) => {
  const baseline = source?.heights ?? world.restoreBaselineHeights;
  const water = source?.waterSurface ?? world.restoreBaselineWater;
  const lake = source ? source.lakeWater ?? new Uint8Array(world.heights.length) : world.restoreBaselineLake;
  if ((!source && !world.restoreBaselineName) || !baseline || !water || !lake)
    throw new Error("Capture a named terrain baseline first.");
  if (baseline.length !== world.heights.length || water.length !== world.heights.length || lake.length !== world.heights.length)
    throw new Error("Terrain baseline dimensions do not match this map.");
  if (!selected.length || selected.length > 32768 || selected.some(cell => !Number.isSafeInteger(cell) ||
    cell < 0 || cell >= world.cellsX * world.cellsZ)) throw new Error("Select a complete bounded contour first.");
  const set = new Set(selected), stride = world.cellsX + 1;
  const cells = getCellsRegion(world, selected);
  const objects = source?.seedBaseline ? seedRestoreProtectedVertices(world, state, cells) : new Set<number>();
  const propProtected = new Set<number>();
  for (let id = 0; id < world.props.count; id++) {
    if (world.props.types[id] === PROP_REMOVED) continue;
    const px = Math.floor(world.props.x[id]!), pz = Math.floor(world.props.z[id]!);
    if (px < cells.minX - 3 || px > cells.maxX + 3 || pz < cells.minZ - 3 || pz > cells.maxZ + 3) continue;
    // Preserve the whole cubic interpolation neighbourhood: no floating or submerged props.
    for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++)
      if (px + dx >= 0 && pz + dz >= 0 && px + dx <= world.cellsX && pz + dz <= world.cellsZ)
        propProtected.add((pz + dz) * stride + px + dx);
  }
  const editable = (x: number, z: number) => {
    if (x <= 0 || z <= 0 || x >= world.cellsX || z >= world.cellsZ) return false;
    for (const dz of [-1, 0]) for (const dx of [-1, 0]) {
      const cell = (z + dz) * world.cellsX + x + dx;
      if (!set.has(cell) || world.settlementGroundClearance?.[cell]) return false;
    }
    const index = z * stride + x;
    // Existing roads and river flows retain their authored/runtime geometry.
    const graded = world.roadGradeApplied && world.roadGradeBase &&
      Math.abs(world.roadGradeApplied[index]! - world.roadGradeBase[index]!) > .00001;
    const originalFlow = source?.flow ? Math.hypot(source.flow[index * 2]!, source.flow[index * 2 + 1]!) : 0;
    return !objects.has(index) && !propProtected.has(index) && !graded && originalFlow < .01 &&
      Math.hypot(world.flow[index * 2]!, world.flow[index * 2 + 1]!) < .01;
  };
  const vertices: number[] = [];
  for (let z = cells.minZ; z <= cells.maxZ + 1; z++) for (let x = cells.minX; x <= cells.maxX + 1; x++) {
    const index = z * stride + x;
    if (editable(x, z) && (world.heights[index] !== baseline[index] || world.waterSurface[index] !== water[index] || (world.lakeWater?.[index] ?? 0) !== lake[index])) vertices.push(index);
  }
  if (!vertices.length) return { cells, changed: 0 };
  if (source?.seedBaseline) assertSeedRestoreBoundary(world, vertices, source);
  state.base ??= { heights: Float32Array.from(world.heights), waterSurface: Float32Array.from(world.waterSurface), splat: Uint8Array.from(world.splat) };
  state.rise ??= new Float32Array(world.heights.length); state.ring ??= new Float32Array(world.heights.length);
  state.lake ??= new Uint8Array(world.heights.length); world.lakeWater ??= new Uint8Array(world.heights.length);
  const centre = { x: (cells.minX + cells.maxX) / 2, z: (cells.minZ + cells.maxZ) / 2 };
  if (!source?.seedBaseline) bakeTouchedStamps(world, state,
    { ...centre, radius: Math.hypot(cells.maxX - cells.minX, cells.maxZ - cells.minZ) + 2 }, editable);
  let changed = 0;
  for (const index of vertices) {
    world.heights[index] = state.base.heights[index] = baseline[index]!;
    world.waterSurface[index] = state.base.waterSurface[index] = water[index]!;
    world.waterDepth[index] = Math.max(0, water[index]! - baseline[index]!);
    world.lakeWater[index] = lake[index]!; state.lake[index] = 0; state.rise[index] = state.ring[index] = 0;
    state.base.splat.set(world.splat.subarray(index * MATERIAL_COUNT, (index + 1) * MATERIAL_COUNT), index * MATERIAL_COUNT);
    changed++;
  }
  const restored = getRestoredCells(world, vertices);
  refreshEditedTerrain(world, restored, true);
  return { cells: restored, changed };
};
