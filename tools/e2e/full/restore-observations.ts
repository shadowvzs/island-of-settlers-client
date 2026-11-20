import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { observeGoodsLedger } from "./ledger-observations";

/** Captured before the first render/update; later wall-clock progression cannot hide lost cargo. */
export const verifyRestoreBoundary = async (page: Page) => {
  const { after, before } = await page.evaluate(() => ({
    before: (window as any).__fullRestoreBoundary, after: (window as any).__fullRestoreResult
  }));
  assert(before && after, "Exact restore boundary observation missing; cannot verify dynamic ownership");
  const actors = (state: any) => state.actors.map((actor: any) => ({ uid: actor.uid, job: actor.job,
    building: actor.building ?? null, ware: actor.ware ?? null, handcart: actor.handcart ?? null }))
    .sort((left: any, right: any) => left.uid - right.uid);
  const buildings = (state: any) => state.buildings.map((building: any) => ({
    uid: building.uid, typeId: building.typeId, construction: building.construction,
    inventory: building.inventory, input: building.input, output: building.output,
    workshopUpgrade: building.workshopUpgrade ?? null
  })).sort((left: any, right: any) => left.uid - right.uid);
  assert.deepEqual(buildings(after), buildings(before), "Building identity, goods, construction or upgrades changed at restore");
  assert.deepEqual(actors(after), actors(before), "Actor ownership or carried goods changed at restore");
  const beforeLedger = observeGoodsLedger(before.buildings, before.actors);
  const afterLedger = observeGoodsLedger(after.buildings, after.actors);
  assert.deepEqual(afterLedger.totals, beforeLedger.totals, "Physical goods changed at restore");
  assert.deepEqual(afterLedger.invalid, [], "Invalid restored goods");
  assert.deepEqual(after.military?.soldiers, before.military?.soldiers, "Troop ownership/intent changed at restore");
  assert.deepEqual(after.tavern, before.tavern, "Recruitment queue changed at restore");
  assert.deepEqual(after.naval, before.naval, "Voyage/cargo/timers changed at restore");
  return { actors: after.actors.length, buildings: after.buildings.length,
    checked: ["pre-update actors/cargo", "building goods/construction/upgrades", "troops", "recruitment", "naval"],
    scope: "Actual simulation save immediately after restoration, before rendering; offline progression remains separate" };
};
