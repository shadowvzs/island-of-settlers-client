import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { createShapeFields } from "../../src/shared/world/generation/heights";
import { chooseLandform, createLandformLayout } from "../../src/shared/world/generation/landforms";
import { applyMountainProfileRelief } from "../../src/shared/world/generation/mountain-profile-relief";

const output = resolve("../resources/terrain-benchmarks/generated-alpine");
mkdirSync(output, { recursive: true });
const receipts = [1234, 7, 42].map(seed => {
  const started = performance.now();
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, seed, mountainProfiles: false });
  const baselineMs = performance.now() - started;
  const { cliffMask } = createShapeFields(world, seed,
    createLandformLayout(seed, chooseLandform(seed)), DEFAULT_WORLD_OPTIONS.mountains);
  const profileStarted = performance.now();
  const changedVertices = applyMountainProfileRelief({ ...world, cliffMask }, DEFAULT_WORLD_OPTIONS.mountains);
  return { seed, size: 256, baselineMs, profileMs: performance.now() - profileStarted,
    changedVertices, profileBytes: 2178, addedRuntimeMeshes: 0, addedRuntimeTextures: 0 };
});
writeFileSync(resolve(output, "budget.json"), JSON.stringify(receipts, null, 2));
