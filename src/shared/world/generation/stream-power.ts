import { getVertexCount, type GridSize } from "../grid-geometry";
import { boxBlurVertices } from "./box-blur";
import { fillDepressions, NEIGHBOURS } from "./hydrology";
import { floodSea } from "./water";

/**
 * Stream-power fluvial carving (M03, docs/plans/mapgen-erosion-design-2026-11-07.md). The designed
 * relief is the uplift field; the analytical steady state of the stream power law along the D8
 * receiver tree (Steer 2021) says where water removes it. A few relaxations let the drainage
 * reorganise on the carved surface; routed sediment refills carved floors (Davy & Lague). Pure and
 * deterministic: additions, square roots and integer bookkeeping only.
 */
export interface StreamPowerSettings {
  /** Share of the incoming sediment that settles per cell of drainage area (G); 0 for none. */
  deposition: number;
  /** Relaxations; each one re-routes the drainage on the carved surface. */
  iterations: number;
  /** 0..1 per vertex: where the carving applies; 0 keeps the vertex. */
  mask: Float32Array;
  /** Lowland base of the design: the uplift source is the relief above it. */
  plainHeight: number;
  /** 0..1 blend of the carved relief into the design. */
  strength: number;
  /**
   * Hillslope spread of the incision: radius-1 blur passes of the carved depth per relaxation, so a
   * channel widens into a valley of a few cells instead of a one-cell gully; 0 keeps raw channels.
   */
  widening: number;
}

/** Valley floors never cut below this height: above the beach band, below the lowland base. */
export const VALLEY_FLOOR = 0.4;
/** Deposits stay this far below the lowest donor, so a refilled floor never becomes a pit. */
const DEPOSIT_EPSILON = 1e-3;

interface ReceiverTree {
  /** Step length to the receiver (1 or SQRT2). */
  distance: Float32Array;
  /** Donors of vertex i: donors[donorStart[i] .. donorStart[i + 1]). */
  donorStart: Int32Array;
  donors: Int32Array;
  /** D8 receiver on the filled surface; -1 for outlets (sea). */
  receiver: Int32Array;
  sea: Uint8Array;
  /** Every vertex after its receiver (outlets first). */
  stack: Int32Array;
}

const findReceivers = (grid: GridSize, filled: Float32Array, sea: Uint8Array) => {
  const count = getVertexCount(grid), stride = grid.cellsX + 1;
  const receiver = new Int32Array(count).fill(-1);
  const distance = new Float32Array(count).fill(1);
  for (let index = 0; index < count; index += 1) {
    if (sea[index]) continue;
    const x = index % stride, z = Math.floor(index / stride);
    let lowest = filled[index]!;
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx > grid.cellsX || nz > grid.cellsZ) continue;
      const neighbour = nz * stride + nx;
      if (filled[neighbour]! >= lowest) continue;
      lowest = filled[neighbour]!;
      receiver[index] = neighbour;
      distance[index] = dx && dz ? Math.SQRT2 : 1;
    }
  }
  return { distance, receiver };
};

/** Donor lists (CSR) and a breadth-first order from the outlets: receivers before their donors. */
const orderFromOutlets = (receiver: Int32Array) => {
  const count = receiver.length;
  const donorStart = new Int32Array(count + 1);
  for (let index = 0; index < count; index += 1) {
    const target = receiver[index]!;
    if (target >= 0) donorStart[target + 1] = donorStart[target + 1]! + 1;
  }
  for (let index = 0; index < count; index += 1) donorStart[index + 1] = donorStart[index + 1]! + donorStart[index]!;
  const donors = new Int32Array(donorStart[count]!);
  const cursor = donorStart.slice(0, count);
  for (let index = 0; index < count; index += 1) {
    const target = receiver[index]!;
    if (target < 0) continue;
    donors[cursor[target]!] = index;
    cursor[target] = cursor[target]! + 1;
  }
  const stack = new Int32Array(count);
  let length = 0;
  for (let index = 0; index < count; index += 1) if (receiver[index]! < 0) stack[length++] = index;
  for (let position = 0; position < length; position += 1) {
    const vertex = stack[position]!;
    for (let donor = donorStart[vertex]!; donor < donorStart[vertex + 1]!; donor += 1) stack[length++] = donors[donor]!;
  }
  return { donorStart, donors, stack };
};

const createReceiverTree = (grid: GridSize, current: Float32Array): ReceiverTree => {
  const sea = floodSea(grid, current, 0);
  const filled = fillDepressions(grid, current, sea);
  const { distance, receiver } = findReceivers(grid, filled, sea);
  return { ...orderFromOutlets(receiver), distance, receiver, sea };
};

/** D8 drainage area in cells: one per land vertex, summed into the receivers. */
const accumulateArea = ({ receiver, sea, stack }: ReceiverTree) => {
  const area = new Float32Array(receiver.length);
  for (let index = 0; index < area.length; index += 1) area[index] = sea[index] ? 0 : 1;
  for (let position = stack.length - 1; position >= 0; position -= 1) {
    const vertex = stack[position]!, target = receiver[vertex]!;
    if (target >= 0) area[target] = area[target]! + area[vertex]!;
  }
  return area;
};

/**
 * Steady-state stream-power profile (m = 0.5, n = 1) upstream from the outlets: tau integrates
 * d / sqrt(A) along the receiver path, the height rises by the local uplift per unit tau. The base
 * level is the sea surface, not the sea floor.
 */
const solveSteadyProfile = (tree: ReceiverTree, area: Float32Array, current: Float32Array, uplift: Float32Array) => {
  const { distance, receiver, stack } = tree;
  const tau = new Float64Array(receiver.length), profile = new Float64Array(receiver.length);
  for (const vertex of stack) {
    const target = receiver[vertex]!;
    if (target < 0) {
      profile[vertex] = Math.max(0, current[vertex]!);
      continue;
    }
    tau[vertex] = tau[target]! + distance[vertex]! / Math.sqrt(area[vertex]!);
    profile[vertex] = profile[target]! + uplift[vertex]! * (tau[vertex]! - tau[target]!);
  }
  return profile;
};

/** Least squares through the origin over the masked relief: ridges keep the design, valleys fall below. */
const fitScale = (design: Float32Array, profile: Float64Array, mask: Float32Array, uplift: Float32Array) => {
  let numerator = 0, denominator = 0;
  for (let index = 0; index < design.length; index += 1) {
    const weight = mask[index]! * uplift[index]!;
    if (weight <= 0) continue;
    numerator += weight * design[index]! * profile[index]!;
    denominator += weight * profile[index]! * profile[index]!;
  }
  return denominator > 0 ? numerator / denominator : 0;
};

/** How far each masked vertex stands above its scaled profile (blended by strength and mask): the wanted incision. */
const measureIncision = (
  current: Float32Array, design: Float32Array, profile: Float64Array, scale: number, settings: StreamPowerSettings
) => {
  const depth = new Float32Array(current.length);
  for (let index = 0; index < current.length; index += 1) {
    const weight = settings.mask[index]!;
    if (weight <= 0) continue;
    const designed = design[index]!;
    const target = Math.max(Math.min(designed, profile[index]! * scale), Math.min(designed, VALLEY_FLOOR));
    const blended = designed + (target - designed) * settings.strength * weight;
    depth[index] = Math.max(0, current[index]! - blended);
  }
  return depth;
};

/** Spreads the incision over the hillslopes (channels become valleys); unmasked vertices stay untouched. */
const widenValleys = (grid: GridSize, depth: Float32Array, mask: Float32Array, passes: number) => {
  if (passes <= 0) return;
  boxBlurVertices(grid, depth, { passes, radius: 1 });
  for (let index = 0; index < depth.length; index += 1) if (mask[index]! <= 0) depth[index] = 0;
};

/** Lowers the vertices by the incision, never below the valley floor; returns the eroded depth. */
const carve = (current: Float32Array, design: Float32Array, depth: Float32Array) => {
  const eroded = new Float32Array(current.length);
  for (let index = 0; index < current.length; index += 1) {
    if (depth[index]! <= 0) continue;
    const floor = Math.min(design[index]!, VALLEY_FLOOR);
    const lowered = Math.max(floor, current[index]! - depth[index]!);
    if (lowered >= current[index]!) continue;
    eroded[index] = current[index]! - lowered;
    current[index] = lowered;
  }
  return eroded;
};

/**
 * Routes the eroded volume downstream; a share of the incoming sediment per cell of drainage area
 * settles where carved ground is available, never above the design or the lowest donor.
 */
const depositSediment = (
  tree: ReceiverTree, area: Float32Array, eroded: Float32Array, current: Float32Array, design: Float32Array,
  share: number
) => {
  const { donors, donorStart, receiver, sea, stack } = tree;
  const flux = new Float64Array(current.length);
  for (let position = stack.length - 1; position >= 0; position -= 1) {
    const vertex = stack[position]!;
    if (sea[vertex]) continue;
    let ceiling = design[vertex]!;
    for (let donor = donorStart[vertex]!; donor < donorStart[vertex + 1]!; donor += 1)
      ceiling = Math.min(ceiling, current[donors[donor]!]! - DEPOSIT_EPSILON);
    const incoming = flux[vertex]!;
    const settled = Math.max(0, Math.min(incoming * share / area[vertex]!, ceiling - current[vertex]!));
    current[vertex] = current[vertex]! + settled;
    const target = receiver[vertex]!;
    if (target >= 0) flux[target] = flux[target]! + incoming - settled + eroded[vertex]!;
  }
};

const createUplift = (design: Float32Array, plainHeight: number) => {
  const uplift = new Float32Array(design.length);
  for (let index = 0; index < design.length; index += 1) uplift[index] = Math.max(0, design[index]! - plainHeight);
  return uplift;
};

/** Carves dendritic valleys into `heights` (unchanged) and returns the carved copy; no vertex rises above its design. */
export const carveStreamPower = (grid: GridSize, heights: Float32Array, settings: StreamPowerSettings) => {
  const current = Float32Array.from(heights);
  const uplift = createUplift(heights, settings.plainHeight);
  for (let iteration = 0; iteration < settings.iterations; iteration += 1) {
    const tree = createReceiverTree(grid, current);
    const area = accumulateArea(tree);
    const profile = solveSteadyProfile(tree, area, current, uplift);
    const scale = fitScale(heights, profile, settings.mask, uplift);
    if (scale <= 0) break;
    const depth = measureIncision(current, heights, profile, scale, settings);
    widenValleys(grid, depth, settings.mask, settings.widening);
    const eroded = carve(current, heights, depth);
    if (settings.deposition > 0) depositSediment(tree, area, eroded, current, heights, settings.deposition);
  }
  return current;
};
