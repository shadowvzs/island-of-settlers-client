import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { CART_STONE_LANE, HANDCART } from "../../src/render-common/logistics/handcart-rules";
import { MOUNTED_NAVIGATION_RADIUS } from "../../src/render-common/mounts/horse-dimensions";
import { planRoadDecorationPlacement, type RoadDecorationPlacementRequest } from "../../src/shared/settlement/road-decoration-placement";

const run = process.argv[2] ?? "cpu-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/verification-completion-2026-11-05/decorations", `${run}.json`);
assert(!existsSync(output), "Preserve prior receipt");
const roadX = 20, roadZ = 30;
const halfWidth = Math.max(MOUNTED_NAVIGATION_RADIUS, CART_STONE_LANE + HANDCART.width / 2 + HANDCART.clearance);
const height = 2.1;
const roads = [{ start: { x: roadX, z: 10 }, end: { x: roadX, z: 50 }, tier: "stone" as const }];
const context = { nation: "roman" as const, roads, heightAt: () => 0, isOwned: () => true, isFree: () => true };
const rows: unknown[] = [];
const start = performance.now();
for (const item of PLANT_COMPLETION_ITEM_IDS) {
  const definition = ROAD_DECORATION_ITEM_DEFINITIONS[item];
  assert(definition?.plant, item);
  for (const yaw of [0, .47, Math.PI / 2, 2.7]) {
    const request: RoadDecorationPlacementRequest = {
      decoration: definition.decoration, position: { x: roadX, z: roadZ }, yaw
    };
    assert.deepEqual(planRoadDecorationPlacement(request, context),
      { ok: false, reason: "road-traffic-obstructed" }, `${item}/${yaw}: reject trunk inside traffic`);
    let lateralOffset = 0;
    let placement = planRoadDecorationPlacement(request, context);
    while (!placement.ok && lateralOffset < 12) {
      lateralOffset += .025;
      placement = planRoadDecorationPlacement({ ...request,
        position: { x: roadX + lateralOffset, z: roadZ } }, context);
    }
    assert(placement.ok, `${item}: no supported roadside placement found`);
    // Independent prism contact check of the accepted actual world-space canonical volumes.
    // This is a rule/physical-union proof, not a posed/animated equipped-mesh witness.
    let nearest = Infinity;
    for (const box of placement.volumes) {
      if (box.min[1] >= height || box.max[1] <= .005) continue;
      if (box.max[2] < 10 || box.min[2] > 50) continue;
      const gap = Math.max(box.min[0] - roadX, roadX - box.max[0], 0);
      nearest = Math.min(nearest, gap);
      assert(gap >= halfWidth - 1e-6, `${item}/${yaw}: accepted physical volume intersects traffic`);
    }
    rows.push({ item, yaw, lateralOffset, volumes: placement.volumes.length, nearest,
      supportCount: placement.supports.length });
  }
}
const sourcePaths = ["src/shared/settlement/road-decoration-placement.ts",
  "src/shared/settlement/road-decoration-traffic.ts", "src/render-common/road-decoration-clearance.ts",
  "src/render-common/plants/catalog-plant-clearance.ts", "src/render-common/logistics/handcart-rules.ts",
  "src/render-common/mounts/horse-dimensions.ts",
  "../island-of-settlers-shared/src/road-plant-completion.ts"];
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify({ status: "passed", models: PLANT_COMPLETION_ITEM_IDS.length,
  acceptedPlacements: rows.length, halfWidth, height, elapsedMs: performance.now() - start,
  sources: Object.fromEntries(sourcePaths.map(path => [path,
    createHash("sha256").update(readFileSync(path)).digest("hex")])), rows,
  scope: "All201 new forms, four rotations, production placement validator and canonical physical union. " +
    "Checks actual accepted world volumes against the traffic prism and intruding-placement refusal. " +
    "Not an animated equipped rider/cart mesh, terrain navigation or hardware FPS acceptance." }, null, 2));
console.log(JSON.stringify({ output, models: PLANT_COMPLETION_ITEM_IDS.length, placements: rows.length }));
