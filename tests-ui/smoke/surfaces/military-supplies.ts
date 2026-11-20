import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { nextFrames } from "../../fixtures/ui";

interface RaisedBuilding {
  uid: number;
  x: number;
  z: number;
}

/** Barracks: two window archers, six-coin supply and the national-drink promotion UI. */
const BARRACKS = 1;

const raise = (page: Page, type: number) => page.evaluate((typeId): RaisedBuilding => {
  const result = (window as any).__settlement.simulation.debugRaiseBuilding(typeId);
  if (!result.ok) throw new Error(`Cannot raise ${typeId}: ${result.reason}`);
  return { uid: result.building.uid, x: result.building.x, z: result.building.z };
}, type);

const details = (page: Page) => page.locator(".settlement-ui__building-details-window");

const openFromMap = async (page: Page, building: RaisedBuilding) => {
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), building);
  await nextFrames(page);
  const screen = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), building);
  await page.mouse.click(screen.x, screen.y);
  await expect(details(page)).toBeVisible();
};

const closeAll = async (page: Page) => {
  await page.locator(".settlement-ui__building-details-window .settlement-ui__drag-handle").focus();
  await page.keyboard.press("Escape");
  await expect(details(page)).toBeHidden();
};

const screenshot = async (page: Page, name: string) => {
  const directory = "../resources/project-reviews/military-supplies-2026-10-27";
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${test.info().project.name}-${name}.png` });
};

/** Wave 2026-10-27: the owner's military window and coin/drink supply review. */
test.describe("military supplies", () => {
  test("shows the coin toggle, local stock and inside units together", async ({ game: { page } }) => {
    const barracks = await raise(page, BARRACKS);
    try {
      await page.evaluate(() => {
        const simulation = (window as any).__settlement.simulation;
        simulation.grantCoins(8);
        simulation.grantDebugTroop({ rank: 0, type: "shield" });
      });
      await page.waitForTimeout(2_000);
      await openFromMap(page, barracks);
      const window = details(page);
      await expect(window.locator(".settlement-ui__garrison-supplies")).toBeVisible();
      const toggle = window.locator(".settlement-ui__garrison-coin");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(toggle).toHaveAccessibleName("Coin deliveries allowed. Click to stop new coin deliveries.");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(toggle).toHaveAccessibleName("Coin deliveries stopped. Click to allow new coin deliveries.");
      await expect(window.locator(".settlement-ui__garrison-coin-x")).toBeVisible();
      await screenshot(page, "coin-toggle-off");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(window.locator(".settlement-ui__garrison-coin-x")).toBeHidden();
      await expect(window.locator("[data-garrison-drink]")).toBeVisible();
      const drink = await window.locator("[data-garrison-drink]").getAttribute("data-garrison-drink");
      expect(["mead", "sake", "toddy", "wine"]).toContain(drink);
      await expect(window.locator("[data-garrison-inside]").first()).toBeVisible({ timeout: 30_000 });
      await screenshot(page, "garrison-supplies");
      await closeAll(page);
    } finally {
      await page.evaluate(uid => {
        const simulation = (window as any).__settlement.simulation;
        if (simulation.buildings().some((building: any) => building.uid === uid))
          simulation.demolishBuilding(uid);
      }, barracks.uid);
    }
  });
});
