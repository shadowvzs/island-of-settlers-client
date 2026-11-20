import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { wareDisplayName } from "../../../src/shared/settlement/ware-names";
import {
  createAcceptanceManifest, productionLaneBuildings, productionModeCaseId, productionUpgradeCaseId
} from "./acceptance-manifest";
import { clickGround } from "./natural-ui-helpers";
import {
  readProductionAttribution, startProductionAttribution, stopProductionAttribution
} from "./production-attribution";
import { MissingPrerequisite } from "./report";
import { isSpecialProductionMode, observeSpecialProduction } from "./special-production-cases";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
export const focusProductionBuilding = async (page: Page, uid: number) => {
  await page.keyboard.press("Escape");
  const point = await page.evaluate((id) => {
    const live = (window as any).__settlement;
    const building = live.simulation.buildings().find((entry: any) => entry.uid === id);
    if (!building) throw new Error(`Building ${id} disappeared`);
    live.focusGround(building.x, building.z);
    return { x: building.x, z: building.z };
  }, uid);
  await page.waitForTimeout(150);
  await clickGround(page, point);
  const panel = page.getByRole("dialog", { name: "Building details", exact: true });
  // The window title follows the selected building, while its close control is stable.
  await page.getByRole("button", { name: "Close building details window", exact: true }).waitFor({ state: "visible" });
  return panel;
};
const inspect = (page: Page, uid: number, outputs: string[]) => page.evaluate(({ outputs, uid }) => {
  const sim = (window as any).__settlement.simulation;
  const state = sim.snapshot(), building = state.buildings.find((entry: any) => entry.uid === uid);
  const storage = state.buildings.filter((entry: any) => [0, 29, 39].includes(entry.typeId));
  return { building, stock: Object.fromEntries(outputs.map(ware => [ware,
    storage.reduce((sum: number, entry: any) => sum + (entry.inventory[ware] ?? 0), 0)])),
  supplies: storage.reduce((goods: Record<string, number>, entry: any) => {
    for (const [ware, amount] of Object.entries(entry.inventory)) goods[ware] = (goods[ware] ?? 0) + Number(amount);
    return goods;
  }, {}), carrier: state.actors.filter((actor: any) => actor.delivery?.source === uid && actor.ware)
    .map((actor: any) => ({ uid: actor.uid, ware: actor.ware, phase: actor.phase, destination: actor.delivery.destination })) };
}, { uid, outputs });

const selectMode = async (page: Page, uid: number, typeId: number, mode: string) => {
  await focusProductionBuilding(page, uid);
  if (typeId === 33 && mode !== "handcart") {
    const button = page.getByRole("radio", { name: `Produce ${wareDisplayName(mode).toLowerCase()}`, exact: true });
    if (!await button.isVisible() || await button.isDisabled())
      throw new MissingPrerequisite(`Sawmill recipe ${mode} requires its sequentially unlocked level`);
    await button.check(); return;
  }
  if (typeId === 36) {
    await page.getByRole("button", { name: `Produce ${mode}`, exact: true }).click();
    return;
  }
  if (typeId === 33) {
    const next = mode === "handcart" ? "hand carts" : mode;
    const toggle = page.getByRole("button", { name: /^(Planks|Hand carts|Boats|Ships): click to produce / });
    const label = await toggle.getAttribute("aria-label");
    if (label?.toLowerCase().endsWith(`produce ${next}`)) await toggle.click();
    return;
  }
  if (typeId === 24) {
    const desired = mode.replace("order:", "");
    for (const ware of ["shield", "sword", "axe", "bow", "armor"]) {
      const row = page.locator(`[data-production-ware="${ware}"]`);
      const unlimited = row.getByRole("button", { name: `Unlimited ${ware} production`, exact: true });
      if (await unlimited.getAttribute("aria-pressed") === "true") await unlimited.click();
      const amount = row.locator("output");
      for (let remaining = Number(await amount.innerText()); remaining > 0; remaining--)
        await row.getByRole("button", { name: `Produce one fewer ${ware}`, exact: true }).click();
      if (ware === desired) for (let index = 0; index < 4; index++)
        await row.getByRole("button", { name: `Produce one more ${ware}`, exact: true }).click();
    }
    return;
  }
  if (mode !== "default") await page.locator(`input[type="radio"][value="${mode}"]`).check();
};

type ManifestBuilding = ReturnType<typeof createAcceptanceManifest>["buildings"][number];
const modeOutputs = (mode: string, recipe: ManifestBuilding["recipes"][number] | undefined, definition: ManifestBuilding) => {
  if (mode.startsWith("order:")) return [mode.slice(6)];
  if (recipe) return [recipe.output];
  return definition.outputs.includes(mode) ? [mode] : definition.outputs;
};

const observeMode = async (page: Page, uid: number, mode: string, definition: ReturnType<typeof createAcceptanceManifest>["buildings"][number]) => {
  const recipe = definition.recipes.find(entry => entry.output === mode);
  const outputs = modeOutputs(mode, recipe, definition);
  const first = await inspect(page, uid, outputs), building = first.building;
  if (!building || building.construction < 1) throw new MissingPrerequisite("Producer is absent or under construction");
  if (building.productionPaused) throw new MissingPrerequisite("Producer is paused in the supplied checkpoint");
  if (definition.tool && building.worker === undefined && !(first.supplies[definition.tool] ?? 0))
    throw new MissingPrerequisite(`No assigned worker or finite ${definition.tool} supply for ${definition.name}`);
  if (isSpecialProductionMode(definition.id, mode)) return observeSpecialProduction(page, uid, definition.id, mode);
  const inputs = recipe ? [recipe.input] : definition.inputs;
  const missing = inputs.filter(ware => !(building.input[ware] || first.supplies[ware]));
  if (definition.alternativeFood ? missing.length === inputs.length : missing.length > 0)
    throw new MissingPrerequisite(`No finite supply for ${definition.name}: ${missing.join(", ")}`);
  const deadline = Date.now() + Math.max(240_000, (definition.seconds ?? 10) * 8_000);
  await startProductionAttribution(page, uid, outputs, definition.id);
  let last = first;
  let attribution: any;
  try {
    while (Date.now() < deadline) {
      last = await inspect(page, uid, outputs);
      assert(last.building, "Producer disappeared while working");
      attribution = await readProductionAttribution(page);
      const feeding = definition.id !== 28 || (attribution.feed.grain >= 3 && attribution.feed.water >= 3);
      if (attribution.cycles >= 4 && attribution.delivered >= 3 && feeding)
        return { mode, first, last, attribution,
          proof: "Four observed source cycle completions (including armory wrap), three matching-ware pickups from this " +
            "building and completed handoffs into identified storage by the same carriers. Global stock is context only." };
      await page.waitForTimeout(500);
    }
  } finally {
    await stopProductionAttribution(page);
  }
  if (["Deposit exhausted", "Waiting for reachable resource", "Waiting for a clear sowing plot"].includes(last.building?.status))
    throw new MissingPrerequisite(`Resource availability/reachability unproven for ${definition.name}: ` +
      `${last.building.status}; ${JSON.stringify(attribution)}. This does not establish whether terrain or routing is faulty.`);
  throw new Error(`Mode ${definition.id}/${mode} lacks source-attributed cycles/deliveries: ${JSON.stringify({ last, attribution })}`);
};

export const runProductionCases = async (page: Page, runCase: RunCase) => {
  const nation = await page.evaluate(() => (window as any).__settlement.simulation.playerNation());
  const manifest = createAcceptanceManifest(nation);
  for (const definition of productionLaneBuildings(manifest)) {
    const uid = await page.evaluate((type) => (window as any).__settlement.simulation.buildings()
      .find((building: any) => building.typeId === type)?.uid, definition.id);
    for (const mode of definition.modes) {
      const modeTitle = `${definition.name}: actual ${mode} production`;
      await runCase(productionModeCaseId(definition.id, mode), modeTitle, async () => {
        if (uid === undefined) throw new MissingPrerequisite(`No ${definition.name} in supplied settlement`);
        await selectMode(page, uid, definition.id, mode);
        return observeMode(page, uid, mode, definition);
      });
    }
    if (!definition.upgrade) continue;
    for (const upgrade of definition.upgrade.steps) {
    const upgradeTitle = `${definition.name}: finite materials and actual builder upgrade`;
    await runCase(productionUpgradeCaseId(definition.id, upgrade), upgradeTitle, async () => {
      if (uid === undefined) throw new MissingPrerequisite(`No ${definition.name} in supplied settlement`);
      const first = await inspect(page, uid, definition.outputs);
      if (!first.building) throw new MissingPrerequisite("Upgrade producer disappeared from supplied checkpoint");
      const current = first.building.workshopUpgrade?.level ?? 0;
      if (current !== upgrade.offset - 1)
        throw new MissingPrerequisite(`Needs actual level ${upgrade.displayedLevel - 1}; checkpoint level ${current + 1} cannot prove this sequential payment/construction history`);
      await focusProductionBuilding(page, uid);
      const action = page.locator(`[data-workshop-upgrade="${uid}"]`);
      if (!await action.isVisible() || await action.isDisabled())
        throw new MissingPrerequisite("Upgrade unavailable: needs finite connected target-tier materials and progression");
      await action.click();
      const button = page.locator(".workshop-upgrade-modal").getByRole("button", { name: "Upgrade", exact: true });
      if (!await button.isVisible() || await button.isDisabled())
        throw new MissingPrerequisite("Upgrade unavailable: needs finite connected target-tier materials and progression");
      await button.click();
      const builders = new Set<number>();
      const deadline = Date.now() + 300_000;
      let last = first;
      while (Date.now() < deadline) {
        last = await inspect(page, uid, definition.outputs);
        const builder = last.building?.workshopUpgrade?.builder;
        if (builder !== undefined) builders.add(builder);
        if (last.building?.workshopUpgrade?.level === upgrade.offset) break;
        await page.waitForTimeout(500);
      }
      assert.equal(last.building?.workshopUpgrade?.level, upgrade.offset, "Finite upgrade did not finish");
      assert(builders.size > 0, "No real upgrade builder was observed");
      const unlockedMode = definition.id === 33 ? definition.recipes[upgrade.offset]!.output : definition.modes[0]!;
      await selectMode(page, uid, definition.id, unlockedMode);
      const upgradedProduction = await observeMode(page, uid, unlockedMode, definition);
      return { first, last, builders: [...builders], cost: upgrade.cost, upgradedProduction,
        scope: "Real UI request/completion and upgraded production; exact cost conservation requires isolated phase ledger" };
    });
    }
  }
};
