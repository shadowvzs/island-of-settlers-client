import type { WorldData } from "../world/world-data";
import type { RoadPoint } from "./road-types";

type Weight = { vertex: number; value: number };
export interface RoadHeightConstraint { weights: Weight[]; limit: number }
/** Catmull-Rom weights of the four samples round `t`, written into `into` (no allocation). */
const cubicWeights = (t: number, into: Float64Array) => {
  into[0] = -.5 * t + t * t - .5 * t * t * t;
  into[1] = 1 - 2.5 * t * t + 1.5 * t * t * t;
  into[2] = .5 * t + 2 * t * t - 1.5 * t * t * t;
  into[3] = -.5 * t * t + .5 * t * t * t;
};

/**
 * A small vertex → summed weight map in scratch arrays, in first-seen order, updated exactly as a `Map` entry
 * `(sum ?? 0) ± value` would be (a point reads 16 vertices, a pair at most 32).
 */
const createWeightSums = (capacity: number) => {
  const vertices = new Int32Array(capacity), values = new Float64Array(capacity);
  let count = 0;
  const update = (vertex: number, value: number, subtract: boolean) => {
    let slot = 0;
    while (slot < count && vertices[slot] !== vertex) slot++;
    const sum = slot < count ? values[slot]! : 0;
    if (slot === count) vertices[count++] = vertex;
    values[slot] = subtract ? sum - value : sum + value;
  };
  return {
    add: (vertex: number, value: number) => update(vertex, value, false),
    clear: () => { count = 0; },
    count: () => count,
    subtract: (vertex: number, value: number) => update(vertex, value, true),
    values,
    vertices
  };
};
type WeightSums = ReturnType<typeof createWeightSums>;
const POINT_VERTICES = 16;
const pairSums = createWeightSums(POINT_VERTICES * 2), pointSums = createWeightSums(POINT_VERTICES);
const columnWeights = new Float64Array(4), rowWeights = new Float64Array(4);

/** Exact linear coefficients of the terrain's Catmull-Rom height sampler, summed into `sums`. */
const addHeightWeights = (world: WorldData, point: RoadPoint, sums: WeightSums) => {
  const x = Math.max(0, Math.min(world.cellsX, point.x)), z = Math.max(0, Math.min(world.cellsZ, point.z));
  const cellX = Math.min(Math.floor(x), world.cellsX - 1), cellZ = Math.min(Math.floor(z), world.cellsZ - 1);
  cubicWeights(x - cellX, columnWeights);
  cubicWeights(z - cellZ, rowWeights);
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4; column++) {
    const vx = Math.max(0, Math.min(world.cellsX, cellX + column - 1));
    const vz = Math.max(0, Math.min(world.cellsZ, cellZ + row - 1));
    sums.add(vz * (world.cellsX + 1) + vx, columnWeights[column]! * rowWeights[row]!);
  }
};
export const roadHeightConstraint = (world: WorldData, a: RoadPoint, b: RoadPoint, limit: number) => {
  pairSums.clear();
  addHeightWeights(world, a, pairSums);
  pointSums.clear();
  addHeightWeights(world, b, pointSums);
  for (let slot = 0; slot < pointSums.count(); slot++)
    pairSums.subtract(pointSums.vertices[slot]!, pointSums.values[slot]!);
  const weights: Weight[] = [];
  for (let slot = 0; slot < pairSums.count(); slot++) {
    const value = pairSums.values[slot]!;
    if (Math.abs(value) > 1e-9) weights.push({ vertex: pairSums.vertices[slot]!, value });
  }
  return { weights, limit };
};

/**
 * The constraints flattened once per projection: every weight's vertex, value and whether it is editable (fixed
 * for the whole projection), and each constraint's squared editable length (the same sum every pass).
 */
const flattenConstraints = (constraints: readonly RoadHeightConstraint[], editable: ReadonlySet<number>) => {
  let total = 0;
  for (const { weights } of constraints) total += weights.length;
  const vertices = new Int32Array(total), values = new Float64Array(total), editables = new Uint8Array(total);
  const ends = new Int32Array(constraints.length), lengths = new Float64Array(constraints.length);
  let slot = 0;
  constraints.forEach(({ weights }, index) => {
    let lengthSquared = 0;
    for (const { value, vertex } of weights) {
      vertices[slot] = vertex;
      values[slot] = value;
      editables[slot] = editable.has(vertex) ? 1 : 0;
      if (editables[slot]) lengthSquared += value * value;
      slot++;
    }
    ends[index] = slot;
    lengths[index] = lengthSquared;
  });
  return { editables, ends, lengths, values, vertices };
};

/** Project actual rendered slope/road camber, with protected foundations and water immutable. */
export const enforceRoadHeights = (
  world: WorldData, constraints: RoadHeightConstraint[], editable: ReadonlySet<number>
) => {
  const { editables, ends, lengths, values, vertices } = flattenConstraints(constraints, editable);
  const { heights } = world, floor = world.seaLevel + .02;
  for (let pass = 0; pass < 64; pass++) {
    let maximum = 0;
    for (let index = 0, start = 0; index < constraints.length; start = ends[index++]!) {
      const end = ends[index]!, lengthSquared = lengths[index]!;
      let difference = 0;
      for (let slot = start; slot < end; slot++) difference += heights[vertices[slot]!]! * values[slot]!;
      const excess = Math.abs(difference) - constraints[index]!.limit;
      if (excess <= .0001 || lengthSquared < 1e-10) continue;
      maximum = Math.max(maximum, excess);
      const correction = excess * Math.sign(difference) / lengthSquared;
      for (let slot = start; slot < end; slot++) if (editables[slot])
        heights[vertices[slot]!] = Math.max(floor, heights[vertices[slot]!]! - correction * values[slot]!);
    }
    if (maximum < .0005) break;
  }
};
