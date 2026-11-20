import assert from "node:assert/strict";

import { DEFAULT_ISLAND_CHOICE, readIslandChoice, toWorldOptions } from "../../src/app/map-generator/helpers";
import { roadIntersectsVisibleRock } from "../../src/shared/settlement/road-rock-footprints";
import { ROAD_STONE_WIDTH } from "../../src/shared/settlement/road-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

/**
 * 512² four-island similar-size archipelago (the URL recipe the game boots from, default seed): all
 * four playable islands are placed and no reserved headquarters-to-harbour road crosses a visible
 * rock. Node only (~6 s): generation depends on neither the browser nor the detail level. The
 * generator form and the failed-generation path are covered by `tests/map-generator-form.test.ts`,
 * `tests/playable-islands.test.ts` and the UI smoke suite (TEST-01, DRV-01).
 * Run: npx tsx tools/bench/playable-islands-review.ts
 */
const query = new URLSearchParams("size=512&landform=archipelago&islandCount=4&similarIslands=1");
const options = { ...DEFAULT_WORLD_OPTIONS, ...toWorldOptions(readIslandChoice(query, DEFAULT_ISLAND_CHOICE)) };
const start = performance.now();
const world = generateWorld(options);
const sites = world.playableIslands?.sites ?? [];
assert.equal(world.cellsX, 512);
assert.equal(sites.length, 4, "every requested island is placed");
const crossing = sites.filter(site =>
  roadIntersectsVisibleRock(world, site.headquarters, site.harbour, ROAD_STONE_WIDTH));
assert.equal(crossing.length, 0, "a reserved connecting road crosses a visible rock");
console.log(JSON.stringify({ islands: sites.length, ms: Math.round(performance.now() - start), seed: world.seed }));
