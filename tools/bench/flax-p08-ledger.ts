import assert from "node:assert/strict";

import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { Goods, SettlementOptions } from "../../src/shared/settlement/settlement-types";
import { SHIPYARD_RECIPES } from "../../src/shared/settlement/shipyard-recipes";

export const createFlaxLedger = () => {
  const produced: Goods = {}, consumed: Goods = {};
  const observe: NonNullable<SettlementOptions["onProductionCycle"]> = (_building, inputs, output) => {
    for (const [ware, count] of Object.entries(inputs)) consumed[ware] = (consumed[ware] ?? 0) + count;
    if (output) produced[output] = (produced[output] ?? 0) + 1;
  };
  return { consumed, observe, produced };
};

/** Exact physical ownership; incoming promises are excluded, private paid inputs counted once. */
export const flaxOwned = (save: GameSaveV1, ware: string) => {
  const { settlement } = save;
  let count = settlement.buildings.reduce((sum, building) => sum + (building.inventory[ware] ?? 0) +
    (building.input[ware] ?? 0) + (building.output[ware] ?? 0) + (building.workshopUpgrade?.reserved?.[ware] ?? 0), 0);
  // Current saves own free wares once per island pool, outside individual building inventories.
  for (const pool of settlement.storagePools?.pools ?? []) count += pool.available[ware] ?? 0;
  for (const bin of settlement.storagePools?.stranded ?? []) count += bin.goods[ware] ?? 0;
  for (const actor of settlement.actors) {
    if (actor.productionSeconds !== undefined) count += actor.consumed?.[ware] ?? 0;
    if (actor.ware === ware && !(actor.productionSeconds !== undefined && (actor.consumed?.[ware] ?? 0) > 0))
      count += actor.wareUnits ?? 1;
    const trip = actor.handcart?.trip;
    if (trip?.ware === ware) count += actor.handcart!.cargo + trip.prepaid;
  }
  if (ware === "planks" || ware === "cloth") {
    count += settlement.naval.fleet.ships.length * SHIPYARD_RECIPES.ships[ware];
    for (const [, site] of settlement.naval.sites) count += ware === "planks" ? site.steps : site.cloth ?? 0;
  }
  return count;
};
export const assertFlaxConservation = (before: GameSaveV1, after: GameSaveV1, ledger: ReturnType<typeof createFlaxLedger>) => {
  const result: Goods = {};
  for (const ware of ["flax", "cloth", "planks", "ironOre"]) {
    const expected = flaxOwned(before, ware) + (ledger.produced[ware] ?? 0) - (ledger.consumed[ware] ?? 0);
    result[ware] = flaxOwned(after, ware);
    assert.equal(result[ware], expected, `Exact ${ware} ownership`);
  }
  const people = (save: GameSaveV1) => save.settlement.settlers + save.settlement.actors.filter(actor =>
    actor.phase !== "retired" && actor.job !== "Mount").length - (save.settlement.settlerBirths ?? 0);
  assert.equal(people(after), people(before), "People equal original finite population plus real births");
  const fields = after.settlement.fields.map(field => field.id);
  assert.equal(fields.length, new Set(fields).size, "Unique field ownership");
  const ids = after.settlement.naval.fleet.ships.map(ship => ship.id);
  assert.equal(ids.length, new Set(ids).size, "Unique completed hulls");
  assert.equal(after.settlement.actors.length, new Set(after.settlement.actors.map(actor => actor.uid)).size, "Unique people");
  for (const typeId of [60, 61, 36]) {
    const building = after.settlement.buildings.find(site => site.typeId === typeId)!;
    const workers = after.settlement.actors.filter(actor => actor.building === building.uid &&
      ["Flax grower", "Weaver", "Shipwright"].includes(actor.job));
    assert(workers.length <= 1, `One producer worker at ${typeId}`);
  }
  return result;
};
