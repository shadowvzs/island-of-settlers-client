import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { GEM_SHOP_OFFER_LIST } from "../../src/shared/progression/gem-shop";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import { islandStorageCapacity } from "../../src/shared/settlement/storage-capacity";
import { flaxOwned } from "./flax-p08-ledger";
import { createNaturalProgressionSession } from "./natural-progression-session";
import { resourcesPath } from "./resources-path";

const out = process.env.OUT ?? resourcesPath("project-reviews", "acceptance-2026-10-28", "sustained-economy", "shared");
const progress = JSON.parse(readFileSync(resolve(out, "progress.json"), "utf8"));
const baseline: GameSaveV1 = JSON.parse(readFileSync(resolve(out, "0-seconds.save.json"), "utf8"));
const final: GameSaveV1 = JSON.parse(readFileSync(resolve(out, "21600-seconds.save.json"), "utf8"));
const last = progress.receipts.at(-1), session = await createNaturalProgressionSession(final), { sim } = session;
assert.equal(last.seconds, 21600);
assert.deepEqual(sim.saveState(), final.settlement, "Completed shared network restores exactly before ticking");
assert.equal(new Set(final.settlement.actors.map(actor => actor.uid)).size, final.settlement.actors.length);
const purchasedLogs = progress.purchases.reduce((sum: number, event: { amount: number }) => sum + event.amount, 0);
const paid = progress.purchases.reduce((sum: number, event: { price: number }) => sum + event.price, 0);
assert.equal(final.player!.gems, 60 - paid);
assert.equal(purchasedLogs, progress.purchases.length * 100);
assert(paid > 0 && paid <= 60);
assert.equal(final.player!.experience, baseline.player!.experience, "Shop turnover grants no XP");
assert(islandStorageCapacity(sim.buildings()).capacity > 1000);
const proof: Record<string, unknown> = {};
for (const [ware, sourceType] of [["coal", 11], ["ironOre", 12], ["goldOre", 13]] as const) {
  const before = flaxOwned(baseline, ware), produced = last.cycles[sourceType], consumed = last.consumed[ware] ?? 0;
  const actual = flaxOwned(final, ware);
  assert.equal(actual, before + produced - consumed, `${ware} exact finite ownership`);
  proof[ware] = { before, produced, consumed, actual };
}
for (const site of sim.buildings().slice(1)) assert(site.cycle > 0, `Every shared producer ${site.typeId} actually cycles`);
const unaffordable = GEM_SHOP_OFFER_LIST.find(offer => offer.ware === "mahoganyLogs")!;
const beforeRefusal = JSON.stringify(session.player.progress());
assert.notEqual(await session.player.buyGemOffer(unaffordable.id), true);
assert.equal(JSON.stringify(session.player.progress()), beforeRefusal);
const carrierStart = sim.frames().filter(actor => actor.job === "Carrier");
const active = new Map(carrierStart.map(actor => [actor.uid, { x: actor.x, z: actor.z, phase: actor.phase, moved: false }]));
for (let step = 0; step < 600; step++) {
  for (let tick = 0; tick < 20; tick++) sim.update(.05);
  const present = new Set(sim.frames().map(actor => actor.uid));
  for (const [uid, value] of active) {
    const actor = sim.frames().find(person => person.uid === uid);
    if (!present.has(uid) || actor && (Math.hypot(actor.x - value.x, actor.z - value.z) > .1 || actor.phase !== value.phase))
      value.moved = true;
  }
}
assert([...active.values()].every(value => value.moved), "Every final active carrier moves, changes phase, or returns during ten-minute liveness window");
writeFileSync(resolve(out, "liveness-end.save.json"), JSON.stringify(await session.save()));
writeFileSync(resolve(out, "report.json"), JSON.stringify({ status: "passed", hours: 6, timestep: .05,
  authored: "Flat128², level50, 100 people, 21 completed connected production buildings, finite HQ stock, three160-ore deposits,60initialgems. Completed sites are explicit fixture assistance, not paid construction.",
  receipts: progress.receipts, purchases: progress.purchases, events: progress.events,
  paidGems: paid, purchasedLogs, remainingGems: final.player!.gems, exactFiniteOreOwnership: proof,
  liveness: { additionalSeconds: 600, carriers: [...active].map(([uid, value]) => ({ uid, ...value })), allProgressed: true },
  affordability: { ware: unaffordable.ware, price: unaffordable.price, refusedWithoutDebit: true },
  scope: "Canonical live resource runtime with actual carriers/production and no post-start grants. Paid log imports are explicit fixed-budget shop transactions. No price retune, earned-gems claim, or native graphics/performance claim. Whole-settlement immediate restoration exact; long continuation parity is separately investigated." }, null, 2));
console.log(`PASS six-hour shared21-chain economy; ${paid} gems buys ${purchasedLogs} logs; all${active.size} final carriers progress`);
