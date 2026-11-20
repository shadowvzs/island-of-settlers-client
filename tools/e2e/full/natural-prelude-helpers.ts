import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { getConstructionCost } from "../../../src/shared/settlement/construction-costs";
import { TAVERN_RECIPES } from "../../../src/shared/settlement/tavern-rules";
import { observeGoodsLedger } from "./ledger-observations";
import { clickGround } from "./natural-ui-helpers";
import { MissingPrerequisite } from "./report";

export const readPrelude = (page: Page) => page.evaluate(() => {
  const sim = (window as any).__settlement.simulation;
  return { ...sim.snapshot(), births: sim.settlerBirths(), nation: sim.playerNation(), soldiers: sim.militarySoldiers(),
    queue: sim.tavernOrders(),
    home: sim.home()?.uid, roadRevision: sim.roadRevision(), seed: (window as any).__fullE2E.world.seed };
});

export const waitForConstructionStock = async (page: Page, type: number) => {
  const cost = getConstructionCost(type), deadline = Date.now() + 300_000;
  let last: Record<string, number> = {};
  while (Date.now() < deadline) {
    const state = await readPrelude(page);
    last = Object.fromEntries(Object.keys(cost).map(ware => [ware, state.buildings.reduce((sum: number, building: any) =>
      sum + ([0, 29, 39].includes(building.typeId) ? building.inventory[ware] ?? 0 : 0), 0)]));
    if (Object.entries(cost).every(([ware, amount]) => (last[ware] ?? 0) >= amount)) return { cost, stored: last };
    await page.waitForTimeout(1000);
  }
  throw new MissingPrerequisite(`Finite natural construction ${type} lacks materials after 300s: ${JSON.stringify({ cost, stored: last })}`);
};

export const openPreludeBuilding = async (page: Page, uid: number) => {
  const state = await readPrelude(page), building = state.buildings.find((item: any) => item.uid === uid);
  assert(building, `Prelude building ${uid} disappeared`);
  await page.keyboard.press("Escape"); await clickGround(page, building);
  await page.getByRole("button", { name: "Close building details window", exact: true }).waitFor({ state: "visible" });
  const selected = await page.evaluate(id => (window as any).__settlement.simulation.buildings()
    .some((item: any) => item.uid === id && item.selected), uid);
  assert(selected, `Map picking selected a different building instead of ${uid}`);
};

/** Finish the accepted cycle before taking an independent recruitment goods ledger. */
export const pausePreludeProducer = async (page: Page, uid: number) => {
  await openPreludeBuilding(page, uid);
  await page.getByRole("button", { name: "Stop production", exact: true }).click();
  await page.getByRole("button", { name: "Close building details window", exact: true }).click();
  await page.waitForFunction(id => {
    const sim = (window as any).__settlement.simulation;
    const building = sim.buildings().find((item: any) => item.uid === id);
    return building?.productionPaused && !building.working && sim.frames().filter((actor: any) => actor.building === id)
      .every((actor: any) => !actor.productionInputs && !actor.productionOutput &&
        !Object.keys(actor.consumed ?? {}).length && ["inside", "rest", "workSearchWait", "workerRestWait"].includes(actor.phase));
  }, uid, { timeout: 180_000 });
  return { uid, action: "Stop production through UI; accepted cycle completed before recruitment ledger" };
};

export const observePreludePlanting = async (page: Page, uid: number) => {
  const firstProp = await page.evaluate(() => (window as any).__fullE2E.world.props.count);
  await page.waitForFunction(({ firstProp, uid }) => {
    const world = (window as any).__fullE2E.world;
    const sim = (window as any).__settlement.simulation;
    const site = sim.buildings().find((item: any) => item.uid === uid);
    for (let index = firstProp; index < world.props.count; index++) {
      if ([0, 1, 2, 15, 18].includes(world.props.types[index]) && world.props.scale[index] < .7 &&
        Math.hypot(world.props.x[index] - site.x, world.props.z[index] - site.z) < 24) return true;
    }
    return false;
  }, { firstProp, uid }, { timeout: 300_000 });
  return { uid, firstProp, newProps: await page.evaluate(() => (window as any).__fullE2E.world.props.count),
    proof: "Actual forester appended a living young tree; no editor tree injection" };
};

const totalHumans = (state: Awaited<ReturnType<typeof readPrelude>>) => state.settlersInside +
  state.actors.filter((actor: any) => actor.job !== "Mount" && actor.phase !== "retired").length;
const births = (state: Awaited<ReturnType<typeof readPrelude>>) => state.births as number;

const settleRecruitmentCargo = async (page: Page) => {
  await page.waitForFunction(wares => {
    const sim = (window as any).__settlement.simulation;
    return sim.frames().every((actor: any) => !actor.ware || !wares.includes(actor.ware)) &&
      sim.buildings().every((building: any) => wares.every((ware: string) =>
        !(building.output[ware] ?? 0) && !(building.incoming[ware] ?? 0)));
  }, Object.keys(TAVERN_RECIPES.shield), { timeout: 180_000 });
};

export const recruitPreludeInfantry = async (page: Page, tavern: number) => {
  await openPreludeBuilding(page, tavern);
  await page.locator("[data-tavern-troop='shield']").click();
  const amount = Number(await page.getByLabel("Recruits to order", { exact: true }).innerText());
  assert(Number.isInteger(amount) && amount >= 1 && amount <= 50);
  for (let count = amount; count > 1; count--)
    await page.getByRole("button", { name: "One recruit fewer", exact: true }).click();
  const missing = await page.locator(".settlement-ui__tavern-ingredient[data-enough='false']").allTextContents();
  if (missing.length) throw new MissingPrerequisite(`Finite first recruit supply: ${missing.join("; ")}`);
  await settleRecruitmentCargo(page);
  const before = await readPrelude(page), beforeLedger = observeGoodsLedger(before.buildings, before.actors);
  const oldIds = new Set(before.soldiers.map((soldier: any) => soldier.actor));
  await page.locator("[data-tavern-order='shield']").click();
  const phases = new Set<string>(), deadline = Date.now() + 240_000;
  let after = before;
  let recruited: any;
  while (Date.now() < deadline) {
    after = await readPrelude(page);
    const order = after.queue.find((entry: any) => entry.uid === tavern);
    if (order?.current) phases.add(order.current.stage);
    recruited = after.soldiers.find((soldier: any) => !oldIds.has(soldier.actor) &&
      (soldier.combat?.faction ?? 0) === 0 && (soldier.combat?.type ?? "shield") === "shield");
    if (recruited && !order?.current && !order?.queue.length) break;
    await page.waitForTimeout(500);
  }
  assert(recruited, `Tavern never produced the finite infantry recruit: ${[...phases].join(",")}`);
  const finalOrder = after.queue.find((entry: any) => entry.uid === tavern);
  assert(!finalOrder?.current && !finalOrder?.queue.length, "Completed single recruit left a pending duplicate Tavern order");
  assert.equal(after.soldiers.filter((soldier: any) => !oldIds.has(soldier.actor)).length, 1,
    "A one-person Tavern order created multiple soldiers");
  await settleRecruitmentCargo(page);
  after = await readPrelude(page);
  const afterLedger = observeGoodsLedger(after.buildings, after.actors);
  for (const [ware, amount] of Object.entries(TAVERN_RECIPES.shield)) {
    assert.equal((afterLedger.totals[ware] ?? 0) - (beforeLedger.totals[ware] ?? 0), -amount,
      `First recruit did not consume the declared finite ${ware} cost`);
  }
  assert.equal(totalHumans(after) - totalHumans(before), births(after) - births(before),
    "Recruitment changed human population beyond recorded natural births");
  await page.getByRole("button", { name: "Close building details window", exact: true }).click();
  return { actor: recruited.actor, type: "shield", rank: recruited.rank, phases: [...phases],
    recipe: TAVERN_RECIPES.shield, beforeLedger, afterLedger,
    humans: { before: totalHumans(before), after: totalHumans(after), naturalBirths: births(after) - births(before) } };
};
