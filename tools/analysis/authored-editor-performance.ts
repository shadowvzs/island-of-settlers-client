import { writeFileSync } from "node:fs";

import { editAuthoredRiver } from "../../src/shared/world/editing/authored-rivers";
import { DEFAULT_WORLD_OPTIONS,generateWorld } from "../../src/shared/world/generation/generate-world";
const started = performance.now();
const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 512, cellsZ: 512, seed: 77, erosionDroplets: 8000 });
const generationMs = performance.now() - started;
const samples: unknown[] = [];
for (const width of [1, 2, 4]) {
  const start = performance.now();
  const region = editAuthoredRiver(world, { id: 1, width, depth: .7,
    points: [{ x: 200, z: 210 }, { x: 220, z: 230 }, { x: 250, z: 260 }] });
  samples.push({ width, milliseconds: performance.now() - start, region: { ...region, removed: region.removed.length },
    patches: world.authoredRivers![0]!.patches.length });
}
const report = { cells: [512, 512], generationMs, samples };
writeFileSync("/tmp/authored-editor-512-performance.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
