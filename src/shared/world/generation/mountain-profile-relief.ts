import { sampleMountainTemplate } from "../editing/terrain/mountain-template";
import { type GridSize,sampleSmooth } from "../grid-geometry";
import { smoothstep } from "../noise";
import { createRandom, deriveSeed } from "../rng";
import { BLOCKING, type WorldData } from "../world-data";
import { computeDistanceField } from "./distance-field";
import { createCellTerrain } from "./gameplay";

/** Only existing cliff interiors change: every vertex touching usable ground stays identical.
 * Baseline coast/river/HQ/deposit geometry and generation placement streams remain intact. */
export const applyMountainProfileRelief = (world: Pick<WorldData,
  "blocking" | "cellsX" | "cellsZ" | "coastDistance" | "heights" | "mineZone" |
  "props" | "riverDistance" | "seed" | "slopeClass" | "start" | "waterDepth"> &
  { cliffMask: Float32Array }, amount: number) => {
  if (amount <= 0 || Math.min(world.cellsX, world.cellsZ) < 96) return 0;
  const { cellsX, cellsZ, heights } = world, stride = cellsX + 1;
  const allowed = new Uint8Array(heights.length), mineBuffer = new Uint8Array(heights.length);
  // Deposit aprons, mineral foundations and their approaches retain baseline shape.
  world.mineZone.forEach((id, cell) => {
    if (!id) return;
    const cx = cell % cellsX, cz = Math.floor(cell / cellsX);
    for (let z = Math.max(0, cz - 6); z <= Math.min(cellsZ, cz + 7); z++)
      mineBuffer.fill(1, z * stride + Math.max(0, cx - 6), z * stride + Math.min(cellsX, cx + 7) + 1);
  });
  for (let z = 1; z < cellsZ; z++) for (let x = 1; x < cellsX; x++) {
    const vertex = z * stride + x;
    if (heights[vertex]! < 3 || mineBuffer[vertex] || world.coastDistance[vertex]! < 10 ||
      world.riverDistance[vertex]! < 8 || Math.hypot(x - world.start.x, z - world.start.z) < 18) continue;
    const cells = [(z - 1) * cellsX + x - 1, (z - 1) * cellsX + x,
      z * cellsX + x - 1, z * cellsX + x];
    if (cells.every(cell => world.blocking[cell] === BLOCKING.cliff)) allowed[vertex] = 1;
  }
  const distance = computeDistanceField(world, vertex => !allowed[vertex]);
  const candidates = [...allowed.keys()].filter(vertex => allowed[vertex] && distance[vertex]! >= 1);
  candidates.sort((a, b) => heights[b]! - heights[a]! || a - b);
  const random = createRandom(deriveSeed(world.seed, "generated-alpine-relief"));
  const centres: { x: number; z: number; cosine: number; sine: number }[] = [];
  for (const vertex of candidates) {
    const x = vertex % stride, z = Math.floor(vertex / stride);
    if (centres.some(centre => Math.hypot(x - centre.x, z - centre.z) < 32)) continue;
    const angle = random() * Math.PI * 2;
    centres.push({ x, z, cosine: Math.cos(angle), sine: Math.sin(angle) });
    if (centres.length >= Math.max(1, Math.round(cellsX * cellsZ / 16384))) break;
  }
  if (!centres.length) return 0;
  const before = heights.slice();
  let changed = 0;
  for (const vertex of candidates) {
    const x = vertex % stride, z = Math.floor(vertex / stride);
    let rise = 0;
    for (const centre of centres) {
      const dx = (x - centre.x) / 24, dz = (z - centre.z) / 24;
      rise = Math.max(rise, sampleMountainTemplate(dx * centre.cosine - dz * centre.sine,
        dx * centre.sine + dz * centre.cosine));
    }
    let delta = rise * .65 * smoothstep(0, 3, distance[vertex]!);
    // Preserve the established natural-slope envelope; authored cliff-mask faces may be
    // steeper, while unmarked mountain terrain cannot acquire a new two-cell spike.
    if (world.cliffMask[vertex]! <= .05) {
      for (const other of [vertex - 2, vertex + 2, vertex - stride * 2, vertex + stride * 2]) {
        if (other < 0 || other >= before.length || world.cliffMask[other]! > .05) continue;
        delta = Math.min(delta, Math.max(0, 3.15 - (before[vertex]! - before[other]!)));
      }
    }
    if (delta < 1e-5) continue;
    heights[vertex] = heights[vertex]! + delta; changed++;
  }
  if (!changed) return 0;
  // Every derived physical layer reads the authoritative changed surface. Tree/rock placement
  // XZ and finite deposit records are untouched; existing props are simply re-grounded.
  for (let index = 0; index < world.props.count; index++) {
    const x = world.props.x[index]!, z = world.props.z[index]!;
    const delta = sampleSmooth(world, heights, x, z) - sampleSmooth(world, before, x, z);
    if (delta) world.props.y[index] = world.props.y[index]! + delta;
  }
  const physical = createCellTerrain(world as GridSize, world);
  world.blocking.set(physical.blocking); world.slopeClass.set(physical.slopeClass);
  return changed;
};
