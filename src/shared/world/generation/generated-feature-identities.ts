import type { GridSize } from "../grid-geometry";

/** Original generator support, not an independently removable post-erosion height layer. */
export interface GeneratedFeatureIdentity {
  version: 1;
  id: number;
  source: "massif" | "oasis";
  kind: "relief" | "water";
  x: number;
  z: number;
  /** Sorted non-overlapping [first cell, consecutive count] runs. Sources may overlap each other. */
  runs: [number, number][];
}

export const featureCellRuns = (cells: ReadonlySet<number>): [number, number][] => {
  const runs: [number, number][] = [];
  for (const cell of [...cells].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last && last[0] + last[1] === cell) last[1]++;
    else runs.push([cell, 1]);
  }
  return runs;
};

export const validGeneratedFeatureIdentities = (value: unknown, grid: GridSize): value is GeneratedFeatureIdentity[] => {
  if (!Array.isArray(value) || value.length > 64) return false;
  let total = 0;
  const ids = new Set<number>(), count = grid.cellsX * grid.cellsZ;
  for (const feature of value) {
    if (!feature || feature.version !== 1 || !Number.isSafeInteger(feature.id) || feature.id < 1 ||
      ids.has(feature.id) || !Number.isFinite(feature.x) || !Number.isFinite(feature.z) ||
      feature.x < 0 || feature.z < 0 || feature.x > grid.cellsX || feature.z > grid.cellsZ ||
      !((feature.source === "massif" && feature.kind === "relief") ||
        (feature.source === "oasis" && feature.kind === "water")) ||
      !Array.isArray(feature.runs) || !feature.runs.length) return false;
    ids.add(feature.id); total += feature.runs.length;
    if (total > 8192) return false;
    let end = -1;
    for (const run of feature.runs) {
      if (!Array.isArray(run) || run.length !== 2 || !run.every(Number.isSafeInteger) ||
        run[0] <= end || run[0] < 0 || run[1] <= 0 || run[0] + run[1] > count) return false;
      end = run[0] + run[1] - 1;
    }
  }
  return true;
};

export const featureContainsCell = (feature: GeneratedFeatureIdentity, cell: number) =>
  feature.runs.some(([first, count]) => cell >= first && cell < first + count);

/** Never partially select a huge original support footprint. */
export const originalFeatureCells = (feature: GeneratedFeatureIdentity, limit = 32768): number[] | null => {
  if (feature.runs.reduce((sum, run) => sum + run[1], 0) > limit) return null;
  return feature.runs.flatMap(([first, count]) => Array.from({ length: count }, (_, i) => first + i));
};
