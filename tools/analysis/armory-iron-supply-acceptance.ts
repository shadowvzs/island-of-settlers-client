import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createHeadlessIsland } from "../../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import type { Goods } from "../../src/shared/settlement/settlement-types";

/** Acceptance for ARMORY-IRON-SUPPLY-01: resume the owner checkpoint, follow the chain and conserve wares. */
const file = process.argv[2];
if (!file) throw new Error("Usage: armory-iron-supply-acceptance.ts <save.json> [output.json]");
const output = process.argv[3] && resolve(process.argv[3]);
const bytes = readFileSync(file);
const source = JSON.parse(bytes.toString("utf8")) as GameSaveV1;

const produced: Goods = {}, consumed: Goods = {};
const events: Array<{ atTick: number; building: number; time: number; inputs: Record<string, number>;
  output?: string }> = [];
const island = await createHeadlessIsland(source, false, false, {
  onProductionCycle: (building, inputs, cycleOutput) => {
    for (const [ware, count] of Object.entries(inputs)) consumed[ware] = (consumed[ware] ?? 0) + count;
    if (cycleOutput) produced[cycleOutput] = (produced[cycleOutput] ?? 0) + 1;
    events.push({ atTick: island.simulation.tickCount(), building: building.uid, time: island.simulation.gameNow(),
      inputs: { ...inputs }, output: cycleOutput });
  }
});
const { simulation } = island;

const total = (goods: Goods) => Object.fromEntries(Object.entries(goods).filter(([, count]) => count !== 0));
const add = (goods: Goods, ware: string, count: number) => {
  if (!Number.isFinite(count) || count < 0) throw new Error(`Invalid ${ware} count ${count}`);
  goods[ware] = (goods[ware] ?? 0) + count;
};
/** Physical custody only: pools, building stores, hands, tools and ship cargo. */
const holdings = (state: SettlementSaveV1) => {
  const goods: Goods = {};
  for (const pool of state.storagePools?.pools ?? [])
    for (const [ware, count] of Object.entries(pool.available)) add(goods, ware, count);
  for (const bin of state.storagePools?.stranded ?? [])
    for (const [ware, count] of Object.entries(bin.goods)) add(goods, ware, count);
  for (const building of state.buildings) {
    for (const store of [building.inventory, building.input, building.output])
      for (const [ware, count] of Object.entries(store)) add(goods, ware, count);
  }
  for (const actor of state.actors) {
    if (actor.ware) add(goods, actor.ware, actor.wareUnits ?? 1);
    // A storage dispatch removes the ware from the pool before the carrier reaches its door.
    else if (actor.delivery && !actor.delivery.reserved) add(goods, actor.delivery.ware, actor.wareUnits ?? 1);
    if (actor.tool) add(goods, actor.tool, 1);
    // `consumed` is physical only while a cycle is in flight; loaded saves may retain the previous
    // cycle's receipt until the next cycle starts. The one in the worker's hand is already counted
    // as `ware`; the rest are still physical custody until the cycle finishes.
    const inCycle = actor.productionInputs !== undefined || actor.productionSeconds !== undefined ||
      actor.productionOutput !== undefined || actor.boatWork !== undefined;
    if (inCycle) {
      const inHand = actor.ware;
      for (const [ware, count] of Object.entries(actor.consumed ?? {}))
        add(goods, ware, count - (ware === inHand ? 1 : 0));
    }
  }
  for (const ship of state.naval.fleet.ships)
    for (const [ware, count] of Object.entries(ship.cargo)) add(goods, ware, count);
  return goods;
};

const initial = holdings(simulation.saveState());
let firstArmoryIron = 0;
let firstArmoryOutput: { at: number; output: string } | undefined;
let firstFounderOutput: { at: number; output?: string } | undefined;
for (let tick = 0; tick <= 2400 * 20; tick++) {
  if (tick) simulation.update(.05);
  if (tick % 20) continue;
  const state = simulation.saveState();
  const armory = state.buildings.find(building => building.typeId === 24)!;
  const founder = state.buildings.find(building => building.typeId === 26)!;
  if (!firstArmoryIron && (armory.input.iron ?? 0) > 0) firstArmoryIron = simulation.tickCount();
  if (!firstFounderOutput) {
    const event = events.find(entry => entry.building === founder.uid && entry.output === "iron");
    if (event) firstFounderOutput = { at: event.atTick, output: event.output };
  }
  if (!firstArmoryOutput) {
    const event = events.find(entry => entry.building === armory.uid && entry.output);
    if (event) firstArmoryOutput = { at: event.atTick, output: event.output! };
  }
  if (firstArmoryOutput) break;
}
const finalState = simulation.saveState();
const final = holdings(finalState);
const armoryStatus = finalState.buildings.find(building => building.typeId === 24)!;
const founderStatus = finalState.buildings.find(building => building.typeId === 26)!;
// Only the iron chain is closed by these receipts. Animal feed and other sinks have their own
// accounting and cannot be treated as production conversions.
const chainWares = ["ironOre", "coal", "iron", "shield", "sword", "axe", "bow"] as const;
const discrepancy: Goods = {};
for (const ware of chainWares) {
  const expected = (initial[ware] ?? 0) + (produced[ware] ?? 0) - (consumed[ware] ?? 0);
  const difference = (final[ware] ?? 0) - expected;
  if (difference !== 0) discrepancy[ware] = difference;
}
const result = {
  file, sourceSha256: createHash("sha256").update(bytes).digest("hex"), finalTick: simulation.tickCount(),
  firstFounderOutput, firstArmoryIron, firstArmoryOutput,
  armory: { input: armoryStatus.input, output: armoryStatus.output, status: armoryStatus.status },
  ironFounder: { input: founderStatus.input, output: founderStatus.output, status: founderStatus.status },
  events: events.filter(entry => entry.building === armoryStatus.uid || entry.building === founderStatus.uid),
  ledger: { initial: total(initial), produced: total(produced), consumed: total(consumed), final: total(final),
    discrepancy: total(discrepancy) },
  productionEvents: events.length,
  passed: Boolean(firstArmoryOutput) && Object.keys(discrepancy).length === 0
};
if (output) {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2));
}
console.log(JSON.stringify(result));
