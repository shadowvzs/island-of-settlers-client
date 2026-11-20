import type { WorldData } from "../../src/shared/world/world-data";

export type ContourSampling = "grid" | "local-peaks";
interface ContourPoint { order: number; x: number; z: number }

/** Spatial order spreads bounded samples; local peaks include legal relief below three tiles. */
export const naturalContourPoints = (
  world: WorldData, avoid: { x: number; z: number }, sampling: ContourSampling
): ContourPoint[] => {
  const points: ContourPoint[] = [], stride = world.cellsX + 1;
  const local = sampling === "local-peaks", margin = local ? 8 : 12, step = local ? 1 : 4;
  for (let z = margin; z < world.cellsZ - margin; z += step)
    for (let x = margin; x < world.cellsX - margin; x += step) {
      const vertex = z * stride + x, height = world.heights[vertex]!;
      if (height < world.seaLevel + (local ? .75 : 3) ||
        Math.hypot(x - avoid.x, z - avoid.z) < 28) continue;
      if (local) {
        const neighbours = [vertex - 1, vertex + 1, vertex - stride, vertex + stride];
        if (neighbours.some(index => world.heights[index]! > height) ||
          neighbours.every(index => world.heights[index] === height)) continue;
      }
      points.push({ order: ((x * 73856093) ^ (z * 19349663)) >>> 0, x, z });
    }
  points.sort((left, right) => left.order - right.order || left.z - right.z || left.x - right.x);
  return local ? points.slice(0, 256) : points;
};

export const naturalContourThresholds = (height: number, seaLevel: number, sampling: ContourSampling) => {
  const relative = height - seaLevel;
  if (sampling === "local-peaks") return [.5, 1, .25, .1, .05]
    .map(depth => Math.max(.5, Math.floor((relative - depth) * 10) / 10));
  return [relative - .25, relative - .5, relative - 1, relative - 1.5, relative - 3, relative / 2, 1]
    .map(level => Math.max(.5, Math.floor(level * 10) / 10));
};
