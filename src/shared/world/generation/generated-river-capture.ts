import {
  GENERATED_RIVER_LIMIT,
  type GeneratedRiver,
  generatedRiverPatchLimit} from "../editing/generated-river-types";
import type { GridSize } from "../grid-geometry";
import type { Waterfall, WorldData } from "../world-data";
import type { CarvedRiver, RiverLayers, RiverWidth } from "./river-carving";

/** Same component order as authored reverse patches; distance is derived after edits. */
export const riverVertexValues = (world: WorldData, vertex: number) => [
  world.heights[vertex]!,
  world.waterSurface[vertex]!,
  world.waterDepth[vertex]!,
  world.flow[vertex * 2]!,
  world.flow[vertex * 2 + 1]!,
  world.riverDistance[vertex]!
];

const stageValues = (
  heights: Float32Array,
  surface: Float32Array,
  flow: Float32Array,
  vertex: number,
  seaLevel: number
) => {
  const level = Number.isFinite(surface[vertex]) ? surface[vertex]! : seaLevel;
  return [
    heights[vertex]!,
    level,
    Math.fround(Math.max(0, level - heights[vertex]!)),
    flow[vertex * 2]!,
    flow[vertex * 2 + 1]!,
    0
  ];
};

/** Capture only actual channel writes. No baseline-sized arrays survive world generation. */
export const createGeneratedRiverCapture = (
  grid: GridSize,
  heights: Float32Array,
  seaLevel: number,
  widthAt: RiverWidth
) => {
  const records: GeneratedRiver[] = [];
  let previous: { heights: Float32Array; surface: Float32Array; flow: Float32Array } | undefined;
  let capturable = true,
    patchCount = 0;
  const before = (river: CarvedRiver, layers: RiverLayers) => {
    if (river.points.length > 2048 || river.mouthStep < 1 || records.length >= GENERATED_RIVER_LIMIT)
      capturable = false;
    if (!capturable) return;
    previous ??= {
      heights: heights.slice(),
      surface: layers.surface.slice(),
      flow: layers.flow.slice()
    };
    previous.heights.set(heights);
    previous.surface.set(layers.surface);
    previous.flow.set(layers.flow);
  };
  const after = (river: CarvedRiver, falls: Waterfall[], layers: RiverLayers) => {
    if (!capturable || !previous) return;
    const patches: GeneratedRiver["patches"] = [];
    for (let vertex = 0; vertex < heights.length; vertex++) {
      if (
        heights[vertex] === previous.heights[vertex] &&
        Object.is(layers.surface[vertex], previous.surface[vertex]) &&
        layers.flow[vertex * 2] === previous.flow[vertex * 2] &&
        layers.flow[vertex * 2 + 1] === previous.flow[vertex * 2 + 1]
      )
        continue;
      patches.push({
        vertex,
        before: stageValues(previous.heights, previous.surface, previous.flow, vertex, seaLevel),
        after: stageValues(heights, layers.surface, layers.flow, vertex, seaLevel)
      });
    }
    patchCount += patches.length;
    if (patchCount > generatedRiverPatchLimit(heights.length)) {
      capturable = false;
      return;
    }
    records.push({
      version: 1,
      id: records.length + 1,
      points: river.points.map((point) => ({ ...point })),
      mouthStep: river.mouthStep,
      widthSamples: river.points.map((point, step) => widthAt(point.x, point.z, step)),
      radius: Array.from(river.radius),
      profile: Array.from(river.profile),
      gorge: Array.from(river.gorge),
      widthScale: 1,
      depthScale: 1,
      patches,
      falls: structuredClone(falls)
    });
  };
  const finish = (world: WorldData): GeneratedRiver[] => {
    previous = undefined;
    // All-or-none avoids claiming ownership over omitted, potentially overlapping channels.
    if (!capturable) return [];
    const latest = new Map<number, number>();
    for (const river of records) for (const patch of river.patches)
      for (let part = 0; part < 5; part++)
        if (patch.before[part] !== patch.after[part]) latest.set(patch.vertex * 5 + part, patch.after[part]!);
    for (const river of records) {
      for (const patch of river.patches) {
        const actual = riverVertexValues(world, patch.vertex);
        for (let component = 0; component < 5; component++) {
          const final = latest.get(patch.vertex * 5 + component);
          if (final === undefined || actual[component] === final) continue;
          // A later captured river retains its ordered ownership chain. Only independent
          // post-generation coast/seabed/mine shaping freezes this component across all layers.
          patch.before[component] = actual[component]!;
          patch.after[component] = actual[component]!;
        }
        patch.before[2] = Math.fround(Math.max(0, patch.before[1]! - patch.before[0]!));
        patch.before[5] = patch.after[5] = actual[5]!;
      }
      river.patches = river.patches.filter((patch) =>
        patch.before.some((value, i) => value !== patch.after[i])
      );
    }
    return records;
  };
  return { after, before, finish };
};
