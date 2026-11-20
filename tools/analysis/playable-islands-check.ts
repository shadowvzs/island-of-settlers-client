// Manual check (slow: every map size, both size modes): every Islands map with the default count must
// generate on the first seed. Exits 1 on any refusal or retry. Run: npx tsx tools/analysis/playable-islands-check.ts
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

let failures = 0;
for (const size of [64, 128, 192, 256, 512]) for (const similar of [false, true]) {
  const start = performance.now();
  const label = `${size}² similar=${similar}`;
  try {
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, erosionDroplets: 100,
      landform: "archipelago", rivers: 0, similarIslandSizes: similar });
    const ms = Math.round(performance.now() - start);
    const retried = world.seed !== DEFAULT_WORLD_OPTIONS.seed;
    if (retried) failures++;
    console.log(`${retried ? "FAIL (needed a retry)" : "ok"} ${label}: ${world.playableIslands?.sites.length} islands, ${ms} ms`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${label}: ${String(error)} (${Math.round(performance.now() - start)} ms)`);
  }
}
if (failures) process.exit(1);
