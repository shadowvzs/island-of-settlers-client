import { riverVertexValues } from "../generation/generated-river-capture";
import { getBedRadius } from "../generation/river-carving";
import { resamplePath } from "../generation/river-line";
import { sampleBilinear } from "../grid-geometry";
import type { WorldData } from "../world-data";
import type { RiverPoint } from "./authored-rivers";
import { type GeneratedRiver,isGeneratedRiverList } from "./generated-river-types";

const indexAt = (world: WorldData, point: RiverPoint) =>
  Math.round(point.z) * (world.cellsX + 1) + Math.round(point.x);
const wet = (world: WorldData, point: RiverPoint) => {
  if (point.x < 0 || point.z < 0 || point.x > world.cellsX || point.z > world.cellsZ) return false;
  const index = indexAt(world, point);
  return world.waterDepth[index]! > .04 && !!(world.flow[index * 2] || world.flow[index * 2 + 1]);
};

/** Explicitly select an existing channel by drawing its centreline, never by replaying an old seed.
 * Adoption changes metadata only. Its reverse patches drain water and retain the measured bed;
 * later geometry edits intentionally reshape this sampled channel, not imaginary original ground. */
export const prepareBakedRiverAdoption = (world: WorldData, course: readonly RiverPoint[]): GeneratedRiver => {
  if (course.length < 2 || course.length > 2048 || course.some(point =>
    !Number.isFinite(point.x) || !Number.isFinite(point.z) || point.x < 0 || point.z < 0 ||
    point.x > world.cellsX || point.z > world.cellsZ))
    throw new Error("Trace 2–2,048 points along an existing river from source to mouth inside the map.");
  const points = resamplePath(course.map(point => ({ ...point })));
  if (points.length < 2 || points.length > 2048)
    throw new Error("The traced river is too short or long; adopt a shorter complete channel.");
  const radii: number[] = [], profile: number[] = [], depths: number[] = [];
  const vertices = new Set<number>();
  const occupied = new Set([...world.generatedRivers ?? [], ...world.authoredRivers ?? []]
    .flatMap(river => river.patches.map(patch => patch.vertex)));
  for (let step = 0; step < points.length; step++) {
    const point = points[step]!;
    if (!wet(world, point)) throw new Error("The trace must follow wet flowing river water, including its source and mouth.");
    const before = points[Math.max(0, step - 1)]!, after = points[Math.min(points.length - 1, step + 1)]!;
    const length = Math.hypot(after.x - before.x, after.z - before.z);
    if (length < .01) throw new Error("The traced channel contains a repeated or folded centreline.");
    const normal = { x: -(after.z - before.z) / length, z: (after.x - before.x) / length };
    const sides = [-1, 1].map(sign => {
      for (let radius = .5; radius <= 12; radius += .5)
        if (!wet(world, { x: point.x + normal.x * radius * sign, z: point.z + normal.z * radius * sign }))
          return Math.max(.5, radius - .25);
      throw new Error("This river is wider than the bounded adoption tool; trace a narrower channel.");
    });
    const radius = (sides[0]! + sides[1]!) / 2;
    radii.push(radius);
    const level = sampleBilinear(world, world.waterSurface, point.x, point.z);
    profile.push(level);
    depths.push(Math.max(0, level - sampleBilinear(world, world.heights, point.x, point.z) - .1));
    // Capture existing wet bed and dry flow levees. Dry unowned banks retain their baked geometry.
    const reach = radius + 3;
    for (let z = Math.max(0, Math.floor(point.z - reach)); z <= Math.min(world.cellsZ, Math.ceil(point.z + reach)); z++)
      for (let x = Math.max(0, Math.floor(point.x - reach)); x <= Math.min(world.cellsX, Math.ceil(point.x + reach)); x++) {
        if (Math.hypot(x - point.x, z - point.z) > reach) continue;
        const vertex = z * (world.cellsX + 1) + x;
        if (!world.flow[vertex * 2] && !world.flow[vertex * 2 + 1]) continue;
        if (occupied.has(vertex)) throw new Error("This channel already overlaps an editable river. Select that definition instead.");
        vertices.add(vertex);
      }
  }
  const mouth = points.findIndex(point => world.waterSurface[indexAt(world, point)]! <= world.seaLevel + .01);
  const mouthStep = mouth < 1 ? points.length - 1 : mouth;
  const patches = [...vertices].sort((a, b) => a - b).map(vertex => {
    const after = riverVertexValues(world, vertex), before = [...after];
    before[1] = Math.max(world.seaLevel, world.heights[vertex]!);
    before[2] = Math.max(0, world.seaLevel - world.heights[vertex]!);
    before[3] = before[4] = 0;
    return { vertex, before, after };
  });
  const river: GeneratedRiver = { version: 1, adopted: true,
    id: 1 + Math.max(0, ...world.generatedRivers?.map(river => river.id) ?? []), points, mouthStep,
    widthSamples: radii.map((radius, step) => radius / getBedRadius(step, mouthStep, 1)),
    radius: radii, profile, gorge: points.map(() => 0), bedDepthSamples: depths,
    widthScale: 1, depthScale: 1, patches,
    falls: structuredClone(world.waterfalls.filter(fall => vertices.has(indexAt(world, fall)) ||
      vertices.has(indexAt(world, { x: fall.poolX, z: fall.poolZ })))) };
  if (!isGeneratedRiverList([...world.generatedRivers ?? [], river], world.cellsX, world.cellsZ))
    throw new Error("This adoption exceeds the bounded river history or profile budget.");
  return river;
};
