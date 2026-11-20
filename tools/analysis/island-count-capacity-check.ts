// Manual check (slow, 512²): the largest offered island count must generate in both size modes.
// Exits 1 on a refusal. Run: npx tsx tools/analysis/island-count-capacity-check.ts
import { maxPlayableIslandCount } from "../../src/shared/world/generation/archipelago-rules";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

const SIZE = 512;
const islandCount = maxPlayableIslandCount(SIZE);
let failures = 0;
for (const similarIslandSizes of [false, true]) {
  const start = performance.now();
  try {
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: SIZE, cellsZ: SIZE, erosionDroplets: 100,
      forest: .35, islandCount, landform: "archipelago", mountains: .35, rivers: 0, similarIslandSizes });
    const count = world.playableIslands?.sites.length;
    if (count !== islandCount) failures++;
    console.log(`${count === islandCount ? "ok" : "FAIL"} similar=${similarIslandSizes}: ${count}/${islandCount} ` +
      `islands, seed ${world.seed}, ${Math.round(performance.now() - start)} ms`);
  } catch (error) {
    failures++;
    console.log(`FAIL similar=${similarIslandSizes}: ${String(error)} (${Math.round(performance.now() - start)} ms)`);
  }
}
if (failures) process.exit(1);
