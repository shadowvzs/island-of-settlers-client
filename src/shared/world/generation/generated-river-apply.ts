import { type GeneratedRiver,generatedRiverPatchLimit } from "../editing/generated-river-types";
import { applyRiverSuppression, riverFallSuppressed } from "../editing/river-water-suppression";
import { sampleBilinear } from "../grid-geometry";
import type { WorldData } from "../world-data";
import { riverVertexValues } from "./generated-river-capture";
import {
  type CarvedRiver,
  carvePreparedRiver,
  CURVATURE_REACH,
  prepareCarvedRiver} from "./river-carving";
import { getCurvatures, resamplePath, smoothPath } from "./river-line";

const resampleWidths = (widths: readonly number[], count: number) =>
  Array.from({ length: count }, (_, i) => {
    const sample = (i / Math.max(1, count - 1)) * (widths.length - 1);
    const low = Math.floor(sample),
      high = Math.min(widths.length - 1, low + 1);
    return widths[low]! + (widths[high]! - widths[low]!) * (sample - low);
  });

/** Only endpoint edits create a new course. Width/depth edits retain the exact original samples. */
const reshapeCourse = (world: WorldData, river: GeneratedRiver): GeneratedRiver => {
  const points = resamplePath(smoothPath(river.points));
  if (
    points.length < 2 ||
    points.length > 2048 ||
    points.some(
      (point) =>
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.z) ||
        point.x < 0 ||
        point.z < 0 ||
        point.x > world.cellsX ||
        point.z > world.cellsZ
    )
  )
    throw new Error("The new river course needs 2–2048 connected samples inside the map.");
  const firstSea = points.findIndex(
    (point) => sampleBilinear(world, world.heights, point.x, point.z) <= world.seaLevel
  );
  if (firstSea === 0) throw new Error("A river source must start on land above sea level.");
  const mouthStep = firstSea < 0 ? points.length - 1 : firstSea;
  const widthSamples = resampleWidths(river.widthSamples, points.length);
  const carved = prepareCarvedRiver(
    world,
    world.heights,
    { points, mouthStep },
    {
      seaLevel: world.seaLevel,
      widthAt: (_x, _z, step = 0) => widthSamples[step]!
    }
  );
  return {
    ...river,
    points,
    mouthStep,
    widthSamples,
    ...(river.bedDepthSamples ? { bedDepthSamples: resampleWidths(river.bedDepthSamples, points.length) } : {}),
    radius: Array.from(carved.radius),
    profile: Array.from(carved.profile),
    gorge: Array.from(carved.gorge)
  };
};

/** Caller owns a private draft and has already restored the selected river's owned patches. */
export const applyGeneratedRiver = (
  world: WorldData,
  river: GeneratedRiver,
  reshape = false
): GeneratedRiver => {
  const next = reshape ? reshapeCourse(world, river) : { ...river };
  const carved: CarvedRiver = {
    points: next.points,
    ...(next.adopted ? { bedDepth: Float32Array.from(next.bedDepthSamples!), replaceBed: true } : {}),
    mouthStep: next.mouthStep,
    curvature: getCurvatures(next.points, CURVATURE_REACH),
    gorge: Float32Array.from(next.gorge),
    profile: Float32Array.from(next.profile),
    radius: Float32Array.from(next.radius, (radius) => radius * next.widthScale)
  };
  const heights = world.heights.slice();
  const layers = carvePreparedRiver(world, heights, carved);
  const patches: GeneratedRiver["patches"] = [];
  for (let vertex = 0; vertex < heights.length; vertex++) {
    const surface = layers.surface[vertex]!;
    if (heights[vertex] === world.heights[vertex] && !Number.isFinite(surface)) continue;
    const before = riverVertexValues(world, vertex);
    // Preserve the seabed at the open mouth; depth scaling applies to inland channel/pool beds.
    if (layers.mask[vertex] && surface > world.seaLevel + 0.001)
      heights[vertex] = surface - Math.max(0, surface - heights[vertex]!) * next.depthScale;
    world.heights[vertex] = heights[vertex]!;
    if (Number.isFinite(surface)) {
      world.waterSurface[vertex] = surface;
      world.flow[vertex * 2] = layers.flow[vertex * 2]!;
      world.flow[vertex * 2 + 1] = layers.flow[vertex * 2 + 1]!;
    }
    world.waterDepth[vertex] = Math.max(0, world.waterSurface[vertex]! - world.heights[vertex]!);
    const after = riverVertexValues(world, vertex);
    if (before.some((value, component) => value !== after[component]))
      patches.push({ vertex, before, after });
    if (patches.length > generatedRiverPatchLimit(heights.length))
      throw new Error(
        "The edited channel exceeds the sparse river history budget. Try a narrower river."
      );
  }
  const mask = applyRiverSuppression(world, next, new Set(patches.map(patch => patch.vertex)));
  for (const patch of patches) patch.after = riverVertexValues(world, patch.vertex);
  const falls = layers.waterfalls.filter(fall => !riverFallSuppressed(world, fall, mask));
  world.waterfalls.push(...falls);
  return { ...next, patches, falls };
};
