import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { MissingPrerequisite } from "./report";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;

/** Read live fleet state; every mutation in this lane comes from ordinary UI buttons. */
export const runShipCases = async (page: Page, runCase: RunCase) => {
  await runCase("E2E-09-island-register", "Current island fleet, real manifests, journey labels and register navigation", async () => {
    const ships = await page.evaluate(() => (window as any).__settlement.simulation.ships());
    if (!ships.length) throw new MissingPrerequisite("Checkpoint needs actual current-island ships; no hulls are granted");
    if (ships.length > 64) throw new MissingPrerequisite("Fleet exceeds this lane's 64-ship review bound");
    const checked: unknown[] = [];
    for (const ship of ships) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      const fleet = page.getByRole("button", { name: "Ships", exact: true });
      assert(!await fleet.isDisabled(), "Fleet register unavailable on the current island");
      await fleet.click();
      await page.getByRole("dialog", { name: "Fleet", exact: true }).waitFor({ state: "visible" });
      const row = page.locator(`[data-ship-id="${ship.id}"]`);
      if (!await row.count()) throw new MissingPrerequisite(`Ship ${ship.id} left this island before inspection`);
      await row.click();
      const panel = page.locator(".settlement-ui__ship-window");
      await panel.waitFor({ state: "visible" });
      assert.equal(await panel.locator("h3").first().innerText(), ship.name);
      const journey = await panel.locator("[data-ship-journey]").innerText();
      assert(journey.includes("→"), "Missing origin/destination");
      if (["Idle", "Route blocked", "Waiting for harbour", "Waiting for entry", "Loading / boarding", "Unloading"]
        .includes(ship.leg)) assert(!journey.includes("≈"), "Stationary/waiting ship has an invented ETA");
      const inventory = await panel.locator("[data-ware]").evaluateAll(nodes => nodes.map(node => ({
        ware: (node as HTMLElement).dataset.ware, count: Number((node as HTMLElement).dataset.count)
      })));
      const passengers = await panel.locator("[data-job]").evaluateAll(nodes => nodes.map(node => ({
        job: (node as HTMLElement).dataset.job, count: Number((node as HTMLElement).dataset.count)
      })));
      assert(inventory.every(item => Number.isFinite(item.count) && item.count >= 0));
      assert(passengers.every(item => Number.isInteger(item.count) && item.count > 0));
      const live = await page.evaluate((id) => (window as any).__settlement.simulation.ships()
        .find((item: any) => item.id === id), ship.id);
      assert(live, "Registered ship disappeared during inspection");
      // Only compare exact manifests on a stable phase/manifest boundary to avoid timing false positives.
      const stable = live.phase === ship.phase && JSON.stringify(live.cargo) === JSON.stringify(ship.cargo) &&
        JSON.stringify(live.passengerTroops) === JSON.stringify(ship.passengerTroops);
      if (!stable) throw new MissingPrerequisite(`Ship ${ship.id} changed transfer state; rerun from a stable voyage checkpoint`);
      for (const [ware, count] of Object.entries(ship.cargo)) if (Number(count) > 0)
        assert.equal(inventory.find(item => item.ware === ware)?.count, count, `${ship.name}: ${ware}`);
      for (const [type, count] of Object.entries(ship.passengerTroops)) if (Number(count) > 0)
        assert.equal(passengers.find(item => item.job === type)?.count, count, `${ship.name}: ${type}`);
      checked.push({ id: ship.id, journey, inventory, passengers });
      await page.keyboard.press("Escape");
    }
    return { checked, scope: "Loaded island simulation fleet; cross-island visibility is exercised by journey lanes" };
  });
};
