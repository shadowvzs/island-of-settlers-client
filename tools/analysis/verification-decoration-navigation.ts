import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS, type RoadDecorationItemId } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { createRoadDecorationState } from "../../src/shared/settlement/road-decoration-state";
import { isMountedNavigationClear } from "../../src/shared/settlement/settlement-navigation";
import type { SettlementContext } from "../../src/shared/settlement/settlement-types";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";

const run = process.argv[2] ?? "navigation-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/verification-completion-2026-11-05/decorations", `${run}.json`);
assert(!existsSync(output), "Preserve prior diagnostic receipt");
const placementFile = process.env.PLACEMENTS ?? "cpu-a.json";
const placement = JSON.parse(readFileSync(resolve(output, "..", placementFile), "utf8"));
const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 64, cellsZ: 64, erosionDroplets: 0 });
world.heights.fill(2); world.blocking.fill(0); world.walkCost.fill(10); world.props.count = 0;
const roads = [{ start: { x: 20, z: 10 }, end: { x: 20, z: 50 }, tier: "stone" as const }];
const owner = createRoadDecorationState(() => ({ nation: "roman", roads,
  heightAt: () => 2, isOwned: () => true, isFree: () => true }));
const context = { options: { world }, buildings: [], actors: [],
  occupied: new Uint8Array(64 * 64), roadDecorations: owner } as unknown as SettlementContext;
assert(isMountedNavigationClear(context, { x: 20, z: 30 }), "The original empty road is mounted-navigable");
const rows: unknown[] = [];
for (const row of placement.rows) {
  owner.load(undefined);
  const result = owner.place({ item: row.item, position: { x: 20 + row.lateralOffset, z: 30 }, yaw: row.yaw }, () => true);
  assert(result.ok, `Recorded accepted placement changed: ${row.item}`);
  const blocked: number[] = [];
  for (let step = 0; step <= 40; step++) {
    const z = 28 + step * .1;
    if (!isMountedNavigationClear(context, { x: 20, z })) blocked.push(z);
  }
  rows.push({ item: row.item, yaw: row.yaw, lateralOffset: row.lateralOffset, blocked });
}
owner.load(undefined);
const portals: unknown[] = [];
const seen = new Set<string>();
for (const [item, definition] of Object.entries(ROAD_DECORATION_ITEM_DEFINITIONS)) {
  if (definition.plant || seen.has(definition.decoration)) continue;
  seen.add(definition.decoration);
  const request = { item: item as RoadDecorationItemId, position: { x: 20, z: 30 }, yaw: 0 };
  if (!owner.plan(request).ok) continue;
  owner.load(undefined);
  assert(owner.place(request, () => true).ok);
  portals.push({ item, mountedClear: isMountedNavigationClear(context, { x: 20, z: 30 }) });
  owner.load(undefined);
}
const blocked = rows.filter((row: any) => row.blocked.length > 0).length;
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify({ models: 201, placements: rows.length, blockedPlacements: blocked,
  status: blocked ? "demonstrated-mounted-path-blockage" : "passed-botanical-mounted-path",
  rows, portals, scope: "Actual production decoration state + canonical isMountedNavigationClear, " +
    "41 centreline samples per accepted roadside placement; generated flat64² owned test terrain. " +
    "Portal diagnostic is separate from the new201 botanical cohort." }, null, 2));
console.log(JSON.stringify({ output, placements: rows.length, blockedPlacements: blocked,
  portalCases: portals.length, blockedPortals: portals.filter((row: any) => !row.mountedClear).length }));
if (process.env.REQUIRE_PASS === "1") assert.equal(blocked, 0, "Accepted botanical decorations must leave mounted road travel clear");
