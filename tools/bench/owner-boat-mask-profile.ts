import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readGameSave } from "../../src/shared/settlement/game-save";
import { createBoatRoutePlanner } from "../../src/shared/settlement/harbour-boat-route";
import { clearNavigationProfile, readNavigationProfile } from "../../src/shared/settlement/navigation-profile";
import { beginFoundationChange, finishFoundationChange } from "../../src/shared/settlement/settlement-foundation-changes";
import { createSeaMask } from "../../src/shared/settlement/settlement-sea-navigation";
import type { SettlementBuilding } from "../../src/shared/settlement/settlement-types";
import { resourcesPath } from "./resources-path";

const input = resourcesPath("project-reviews", "build-all-slowdown-2026-11-04", "browser",
  "residual-high", "high-build-all-save.json");
const source = readFileSync(input);
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const { map } = await readGameSave(JSON.parse(source.toString()));
const { world } = map, sea = createSeaMask(world), planner = createBoatRoutePlanner(world, sea);
const dry = world.heights.findIndex(height => height > world.seaLevel + .5);
assert(dry >= 0);
const building = { x: dry % (world.cellsX + 1), z: Math.floor(dry / (world.cellsX + 1)),
  width: 2, depth: 2 } as SettlementBuilding;
const points = Array.from({ length: 256 }, (_, index) => ({
  x: (index * 17 % world.cellsX) + .5, z: (index * 43 % world.cellsZ) + .5
}));
const answers = points.map(point => planner.canTurn(point));
(globalThis as { __navigationProfile?: boolean }).__navigationProfile = true;
clearNavigationProfile();
const started = performance.now();
for (let step = 0; step < 40; step++) {
  const change = beginFoundationChange(world, building);
  world.heights[dry] = world.heights[dry]! + (step % 2 ? -.005 : .005);
  world.terrainRevision = (world.terrainRevision ?? 0) + 1;
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  finishFoundationChange(world, change);
  assert.deepEqual(points.map(point => planner.canTurn(point)), answers);
}
const result = { label: process.argv[2] ?? "current", input, inputHash: digest(source),
  ms: performance.now() - started, revisions: 40, checks: 40 * points.length,
  answerHash: digest(JSON.stringify(answers)), navigation: readNavigationProfile() };
const output = resourcesPath("project-reviews", "build-all-slowdown-2026-11-04", "boat-mask");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, `${result.label}.json`), JSON.stringify(result, null, 2));
assert.equal(digest(readFileSync(input)), result.inputHash);
console.log(JSON.stringify(result));
