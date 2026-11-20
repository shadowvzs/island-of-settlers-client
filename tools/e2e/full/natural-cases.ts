import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { choosePlot, clickGround, connectBuildingUi, selectBuilding } from "./natural-ui-helpers";
import {
  readProductionAttribution, startProductionAttribution, stopProductionAttribution
} from "./production-attribution";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;

export const constructNaturally = async (
  page: Page, type: number, findPlot = choosePlot
) => {
  const before = await page.evaluate(() => (window as any).__settlement.simulation.snapshot());
  assert(before.buildings.some((building: any) => building.typeId === 0 && building.construction >= 1),
    "Natural branch requires a completed starting HQ");
  assert(!before.buildings.some((building: any) => building.typeId === type),
    `Natural branch must not already contain building ${type}`);
  await selectBuilding(page, type);
  const plot = await findPlot(page, type);
  await clickGround(page, plot);
  await page.waitForFunction((typeId) => (window as any).__settlement.simulation.buildings()
    .some((building: any) => building.typeId === typeId), type, { timeout: 10_000 });
  const planned = await page.evaluate((typeId) => (window as any).__settlement.simulation.snapshot().buildings
    .find((building: any) => building.typeId === typeId), type);
  assert(planned.construction < 1, "UI placement unexpectedly produced a completed building");
  const road = await connectBuildingUi(page, planned.uid);
  const actorPhases = new Set<string>();
  const constructionSamples: unknown[] = [];
  const deadline = Date.now() + 240_000;
  let completed: any;
  while (Date.now() < deadline) {
    const state = await page.evaluate((uid) => {
      const snapshot = (window as any).__settlement.simulation.snapshot();
      return { building: snapshot.buildings.find((item: any) => item.uid === uid),
        actors: snapshot.actors.filter((actor: any) => actor.building === uid)
          .map((actor: any) => ({ uid: actor.uid, job: actor.job, phase: actor.phase, ware: actor.ware })) };
    }, planned.uid);
    assert(state.building, "Building disappeared during natural construction");
    for (const actor of state.actors) actorPhases.add(`${actor.job}:${actor.phase}:${actor.ware ?? "empty"}`);
    constructionSamples.push({
      progress: state.building.construction, consumed: state.building.constructionConsumed, actors: state.actors
    });
    if (constructionSamples.length > 40) constructionSamples.shift();
    if (state.building.construction >= 1) { completed = state.building; break; }
    await page.waitForTimeout(500);
  }
  assert(completed, `Natural building ${type} failed to finish within 240 wall seconds: ${JSON.stringify({
    actorPhases: [...actorPhases], last: constructionSamples.at(-1)
  })}`);
  assert([...actorPhases].some(phase => /builder/i.test(phase)), "No actual builder assignment was observed");
  const consumed = Object.values(completed.constructionConsumed ?? {}).reduce<number>((sum, value) => sum + Number(value), 0);
  assert(consumed > 0, "Completed natural construction has no consumed-material ledger");
  return { type, uid: completed.uid, plot, road, actorPhases: [...actorPhases],
    constructionSamples, completed };
};

export const observeProduction = async (page: Page, uid: number, ware: string, seconds = 240) => {
  const initial = await page.evaluate(({ uid, ware }) => {
    const state = (window as any).__settlement.simulation.snapshot();
    return { cycle: state.buildings.find((building: any) => building.uid === uid)?.cycle ?? 0,
      stock: state.buildings.reduce((sum: number, building: any) => sum + (building.inventory[ware] ?? 0), 0) };
  }, { uid, ware });
  const producer = await page.evaluate((id) => (window as any).__settlement.simulation.buildings()
    .find((building: any) => building.uid === id), uid);
  assert(producer, `Natural producer ${uid} is missing`);
  const deadline = Date.now() + seconds * 1000;
  let last: any, attribution: any;
  await startProductionAttribution(page, uid, [ware], producer.typeId);
  try {
    while (Date.now() < deadline) {
      last = await page.evaluate(({ uid, ware }) => {
        const state = (window as any).__settlement.simulation.snapshot();
        return { building: state.buildings.find((building: any) => building.uid === uid),
          stock: state.buildings.reduce((sum: number, building: any) => sum + (building.inventory[ware] ?? 0), 0) };
      }, { uid, ware });
      assert(last.building, `Natural producer ${uid} disappeared while observing production`);
      attribution = await readProductionAttribution(page);
      if (attribution.cycles >= 3 && attribution.delivered >= 3)
        return { initial, final: last, attribution, observedPhases: attribution.observedPhases,
          proof: "Three source cycles and three observed pickups from this producer, followed by same-carrier " +
            "handoffs into identified storage. Net storage changes are context only." };
      await page.waitForTimeout(500);
    }
  } finally {
    await stopProductionAttribution(page);
  }
  throw new Error(`Producer ${uid}/${ware}: source-attributed cycles and storage handoffs not proved within ` +
    `${seconds}s: ${JSON.stringify({ last, attribution })}`);
};

export const runNaturalCases = async (page: Page, runCase: RunCase) => {
  let wellUid: number | undefined;
  let woodcutterUid: number | undefined;
  await runCase("E2E-04-natural-well", "UI well, dirt road, material delivery and real builder", async () => {
    const evidence = await constructNaturally(page, 35);
    wellUid = evidence.uid;
    return evidence;
  });
  await runCase("E2E-04-natural-woodcutter", "UI woodcutter, dirt road and real construction", async () => {
    const evidence = await constructNaturally(page, 17);
    woodcutterUid = evidence.uid;
    return evidence;
  });
  await runCase("E2E-06-natural-well", "Well produces three cycles and delivers water into storage", async () => {
    assert(wellUid !== undefined, "Prerequisite natural well construction did not pass");
    return observeProduction(page, wellUid, "water");
  });
  await runCase("E2E-06-natural-woodcutter", "Woodcutter uses existing trees and delivers three timber cycles", async () => {
    assert(woodcutterUid !== undefined, "Prerequisite natural woodcutter construction did not pass");
    return observeProduction(page, woodcutterUid, "logs");
  });
  await runCase("E2E-12-quest-ui", "Quest journal opens, selects objectives and preserves entries on reopening", async () => {
    await page.getByRole("button", { name: /^Quests(?::|$)/ }).click();
    const journal = page.getByRole("dialog", { name: "Quests", exact: true });
    await journal.waitFor({ state: "visible" });
    const entries = journal.locator("[data-quest-id]");
    assert(await entries.count() > 0, "Normal starter account has no quest entries; quest prerequisite is missing");
    const reviewed = [];
    for (let index = 0; index < await entries.count(); index++) {
      await entries.nth(index).click();
      reviewed.push({ id: await entries.nth(index).getAttribute("data-quest-id"), text: await journal.innerText() });
    }
    await journal.getByRole("button", { name: "Close quests window", exact: true }).click();
    await page.getByRole("button", { name: /^Quests(?::|$)/ }).click();
    await journal.waitFor({ state: "visible" });
    assert.equal(await entries.count(), reviewed.length);
    await journal.getByRole("button", { name: "Close quests window", exact: true }).click();
    return { reviewed, scope: "Journal visibility/selection only; reward and objective progression require journey cases" };
  });
};
