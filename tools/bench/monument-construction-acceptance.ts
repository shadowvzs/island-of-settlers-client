import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { getConstructionCost } from "../../src/shared/settlement/construction-costs";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { flaxOwned } from "./flax-p08-ledger";
import { createNaturalProgressionSession } from "./natural-progression-session";

const output = resolve(process.env.OUT ?? "../resources/project-reviews/acceptance-2026-10-28/monument-construction");
await mkdir(output, { recursive: true });
const persist = async (name: string, value: unknown) => writeFile(resolve(output, name), JSON.stringify(value, null, 2));
const cost = getConstructionCost(7), wares = Object.keys(cost);
const create = async (missing = false) => {
  const world = huntingWorld(), stock: Record<string, number> = { ...cost, hammer: 1 };
  const sim = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 40, initialStock: stock });
  const raw = await createGameSave(world, sim.saveState(), { name: "Authored finite paid Monument construction",
    source: "generated", savedAt: 1_000_000, animals: [] });
  raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[49]!, talents: {} };
  const session = await createNaturalProgressionSession(raw);
  const placed = session.sim.placeBuilding(7, 32.5, 32.5);
  assert(placed.ok && placed.building, placed.reason ?? "Monument plot");
  assert(session.sim.connectRoads(session.sim.headquarters.access, placed.building.access));
  if (missing) assert.equal(session.sim.takeStoredGoods({ granite: 1 }).granite, 1);
  return { session, uid: placed.building.uid };
};
const { session, uid } = await create();
await persist("initial.json", await session.save());
let partial: Awaited<ReturnType<typeof session.save>> | undefined;
for (let tick = 0; tick < 80000; tick++) {
  session.sim.update(.05);
  const building = session.sim.buildings().find(site => site.uid === uid)!;
  if (building.construction >= .25) { partial = await session.save(); break; }
}
assert(partial, "Paid natural deliveries reach quarter-built Monument");
await persist("partial.json", partial);
const receipts = [];
for (const branch of ["continuous", "restored"]) {
  const current: Awaited<ReturnType<typeof createNaturalProgressionSession>> = branch === "continuous" ? session : await createNaturalProgressionSession(partial);
  for (let tick = 0; tick < 100000; tick++) {
    current.sim.update(.05);
    if (current.sim.buildings().find(site => site.uid === uid)!.construction === 1) break;
  }
  const building = current.sim.buildings().find(site => site.uid === uid)!;
  if (building.construction !== 1) { await persist(`${branch}-failed.json`, await current.save()); throw new Error(`${branch} construction stalled at${building.construction}`); }
  assert.deepEqual(building.constructionConsumed, cost, "Every one of200materials consumed once");
  for (let tick = 0; tick < 6000; tick++) current.sim.update(.05);
  const final = await current.save();
  for (const ware of wares) assert.equal(flaxOwned(final, ware), 0, `No duplicated or unconsumed ${ware}`);
  assert.equal(current.sim.headquarters.inventory.hammer, 1);
  assert.equal(current.sim.population().people, 40 + current.sim.settlerBirths());
  await persist(`${branch}-completed.json`, final);
  receipts.push({ branch, construction: building.construction, consumed: building.constructionConsumed,
    people: current.sim.population().people, births: current.sim.settlerBirths() });
}
// Cancelling a partial site refunds only real unconsumed holdings, never already built materials.
const cancellation = await createNaturalProgressionSession(partial);
const consumed = { ...cancellation.sim.buildings().find(site => site.uid === uid)!.constructionConsumed };
assert(cancellation.sim.demolishBuilding(uid).ok);
const cancelled = await cancellation.save(); await persist("cancelled-in-transit.json", cancelled);
const returned = await createNaturalProgressionSession(cancelled);
for (let tick = 0; tick < 16000; tick++) returned.sim.update(.05);
const refund = await returned.save();
for (const ware of wares) assert.equal(flaxOwned(refund, ware), cost[ware]! - (consumed[ware] ?? 0), `Exact ${ware} cancellation refund`);
assert.equal(returned.sim.headquarters.inventory.hammer, 1);
assert.equal(returned.sim.demolishBuilding(uid).ok, false);
await persist("cancelled-returned.json", refund);
const missing = await create(true);
for (let tick = 0; tick < 100000; tick++) missing.session.sim.update(.05);
const missingSite = missing.session.sim.buildings().find(site => site.uid === missing.uid)!;
assert.equal(missingSite.construction, .995, "One missing granite keeps last hammer contact blocked");
assert.equal(missingSite.constructionConsumed!.granite, 19);
await persist("missing-last-granite.json", await missing.session.save());
const report = { provenance: "Authored level50 synthetic world,40people,exact finite200materials+onehammer; actual paid deliveries,buildercontacts and canonical full-save restoration. No grants, prebuilt site or debug unlock.",
  receipts, cancellationConsumed: consumed, refundExact: true, missingGraniteProgress: missingSite.construction };
await persist("report.json", report); console.log(JSON.stringify(report));
