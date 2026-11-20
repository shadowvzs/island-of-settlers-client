import { LEVEL_THRESHOLDS } from "@shared/catalog/balance";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { GEM_SHOP_OFFER_LIST } from "../../src/shared/progression/gem-shop";
import { createPlayerProgress } from "../../src/shared/progression/player-progress";
import { createGameSave } from "../../src/shared/settlement/game-save";
import { createRoadNetwork } from "../../src/shared/settlement/road-network";
import { requiredMineOre } from "../../src/shared/settlement/settlement-placement";
import { createSettlementSimulation } from "../../src/shared/settlement/settlement-simulation";
import { islandStorageCapacity } from "../../src/shared/settlement/storage-capacity";
import { huntingWorld } from "../../tests/helpers/hunting-world";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const out = process.env.OUT ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "sustained-economy", "shared");
mkdirSync(out, { recursive: true });
const world = huntingWorld(128);
world.waterDepth.fill(0); world.waterSurface.fill(world.seaLevel); world.lakeWater?.fill(0);
world.start = { x: 64, z: 64 };
world.mineZone.fill(0); world.oreAmount.fill(0); world.mineZones = [];
const initialStock = { logs: 950, planks: 400, stone: 100, hardwoodPlanks: 30, iron: 40, marble: 30,
  hammer: 8, pickaxe: 5, saw: 4, cleaver: 4, tongs: 4, crucible: 4, scythe: 3, shovel: 3, rollingPin: 2,
  bread: 200, meat: 100, pig: 100, water: 200, coal: 100, ironOre: 100, goldOre: 50, grain: 100,
  flour: 50, hides: 50, leather: 50, flax: 100, cloth: 100 };
let initial: ReturnType<typeof createSettlementSimulation>;
const roads = createRoadNetwork(world, { isBlocked: (x, z) => initial?.isOccupied(x, z) ?? false });
initial = createSettlementSimulation({ world, roads, initialSettlers: 100,
  initialStock, playerLevel: () => 50, unlockAllBuildings: true });
const types = [35, 37, 31, 32, 28, 21, 3, 8, 15, 60, 61, 11, 12, 13, 26, 25, 34, 5, 6, 23, 33];
const plots = Array.from({ length: 25 }, (_, i) => ({ x: 34 + i % 5 * 14, z: 34 + Math.floor(i / 5) * 14 }))
  .filter(point => Math.hypot(point.x - 64, point.z - 64) > 10);
for (const [index, type] of types.entries()) {
  const [w, d] = getBuildingDefinition(type).gridFootprint;
  const x = plots[index]!.x + w % 2 / 2, z = plots[index]!.z + d % 2 / 2;
  const ore = requiredMineOre(type);
  if (ore) {
    const cell = Math.floor(z) * world.cellsX + Math.floor(x), id = world.mineZones.length + 1;
    world.mineZone[cell] = id; world.oreAmount[cell] = 160;
    world.mineZones.push({ id, ore, cellCount: 1, centreX: x, centreZ: z, richness: 1, surveyed: true });
  }
  const placed = initial.placeBuilding(type, x, z);
  assert(placed.ok && placed.building, `${type}: ${placed.reason}`);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });

  if (type === 25) assert(initial.setProductionMode(placed.building.uid, "hammer"));
}
for (const site of initial.buildings().slice(1))
  assert(initial.connectRoads(initial.headquarters.access, site.access), `Road to ${site.typeId}`);
const raw = await createGameSave(world, initial.saveState(), { name: "Authored finite shared economy", source: "generated", savedAt: 1_000_000, animals: [] });
raw.player = { ...createPlayerProgress(world.seed), experience: LEVEL_THRESHOLDS[49]!, gems: 60, talents: {} };
const cycles: Record<number, number> = {}, consumed: Record<string, number> = {};
const session = await createNaturalProgressionSession(raw, (site, inputs) => {
  cycles[site.typeId] = (cycles[site.typeId] ?? 0) + 1;
  for (const [ware, count] of Object.entries(inputs)) consumed[ware] = (consumed[ware] ?? 0) + count;
});
const { player, sim } = session, receipts: unknown[] = [], purchases: unknown[] = [], events: unknown[] = [];
const originalXP = player.progress().experience;
const offer = GEM_SHOP_OFFER_LIST.find(value => value.id === "logs-100")!;
assert.equal(offer.price, 10);
const refusedBefore = JSON.stringify(player.progress());
assert.notEqual(await player.buyGemOffer(offer.id), true, "Per-ware capacity rejects initial 950+100 logs");
assert.equal(JSON.stringify(player.progress()), refusedBefore, "Capacity refusal cannot debit gems");
let bought = 0, upgradeRequested = false;
const hours = Number(process.env.HOURS ?? 6);
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const snapshot = async (seconds: number) => {
  const save = await session.save();
  writeFileSync(resolve(out, `${seconds}-seconds.save.json`), JSON.stringify(save));
  assert.equal(new Set(save.settlement.actors.map(actor => actor.uid)).size, save.settlement.actors.length);
  receipts.push({ seconds, sha256: fingerprint(save), cycles: { ...cycles }, consumed: { ...consumed },
    capacity: islandStorageCapacity(sim.buildings()), gems: player.progress().gems,
    buildings: sim.buildings().map(site => ({ uid: site.uid, type: site.typeId, cycle: site.cycle, status: site.status,
      input: site.input, output: site.output })),
    phases: sim.frames().reduce<Record<string, number>>((values, actor) => {
      values[actor.phase] = (values[actor.phase] ?? 0) + 1; return values;
    }, {}) });
  writeFileSync(resolve(out, "progress.json"), JSON.stringify({ receipts, purchases, events }, null, 2));
  console.log(`${seconds / 3600}h ${JSON.stringify(cycles)}, gems${player.progress().gems}`);
};
await snapshot(0);
for (let seconds = 0; seconds < hours * 3600; seconds += 10) {
  if (bought < 6 && sim.canDeliverHome({ logs: 100 })) {
    const before = sim.resourceTotal("logs"), gems = player.progress().gems;
    assert.equal(await player.buyGemOffer(offer.id), true);
    assert.equal(sim.resourceTotal("logs"), before + 100);
    assert.equal(player.progress().gems, gems - offer.price);
    assert.equal(player.progress().experience, originalXP, "Purchases grant no XP");
    purchases.push({ seconds, ware: offer.ware, amount: offer.amount, price: offer.price }); bought++;
  }
  if (!upgradeRequested && seconds >= hours * 1800) {
    assert(sim.requestWorkshopUpgrade(sim.headquarters.uid), "Finite paid HQ upgrade");
    events.push({ seconds, kind: "paid-headquarters-capacity-upgrade" }); upgradeRequested = true;
  }
  for (let tick = 0; tick < 200; tick++) sim.update(.05);
  if ((seconds + 10) % 3600 === 0) await snapshot(seconds + 10);
}
assert(bought > 0, "Actual processing and paid capacity expansion admit finite-budget purchases");
assert.equal(player.progress().gems, 60 - bought * offer.price);
const unaffordable = GEM_SHOP_OFFER_LIST.find(value => value.ware === "mahoganyLogs")!;
const beforeRefusal = JSON.stringify(player.progress());
assert.notEqual(await player.buyGemOffer(unaffordable.id), true, "Canonical tier4 price exceeds remaining finite budget");
assert.equal(JSON.stringify(player.progress()), beforeRefusal, "Affordability refusal cannot debit gems");
assert(islandStorageCapacity(sim.buildings()).capacity > 1000, "Paid capacity upgrade completes under shared traffic");
for (const type of types) assert((cycles[type] ?? 0) > 0, `Shared type${type} completes production`);
const final = await session.save();
const restored = await createNaturalProgressionSession(final);
assert.deepEqual(restored.sim.saveState(), sim.saveState(), "Shared finite network settlement restores exactly");
writeFileSync(resolve(out, "report.json"), JSON.stringify({ status: "passed", hours, timestep: .05,
  initialStock, authored: { level: 50, people: 100, completedConnectedBuildings: types, finiteGems: 60,
    finiteOrePerMine: 160, flatTerrain: true }, postStartGrants: 0, imports: purchases, receipts, events,
  limits: "Authored completed Roman network, not earned construction or all-national sustained acceptance. Purchases are deliberate paid imports from a fixed initial gem budget; no balance retune." }, null, 2));
console.log("PASS finite shared economy and paid capacity/shop turnover");
