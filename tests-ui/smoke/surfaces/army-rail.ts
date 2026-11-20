import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectInsideViewport } from "../../fixtures/ui";

const rail = (page: Page) => page.locator(".army-action-rail");
const railButton = (page: Page, name: string) => rail(page).getByRole("button", { exact: true, name });
/** The map surface's computed cursor while it carries a soldier order cursor ("" without one). */
const mapCursor = (page: Page) => page.evaluate(() => {
  const surface = document.querySelector<HTMLElement>("[data-army-cursor]");
  return surface ? `${surface.dataset.armyCursor} ${getComputedStyle(surface).cursor}` : "";
});
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** Wave 3d: soldier action rail (React view; orders, picking and box select stay in TypeScript). */
test.describe("army action rail", () => {
  // The rail shows only with a soldier on the island; a fresh game has none, so store one in HQ.
  test.beforeEach(async ({ game: { page } }) => {
    await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      if (!simulation.militarySoldiers().length) simulation.grantDebugTroop({ rank: 0, type: "shield" });
    });
  });

  test("order and Box select toggles exclude each other; Escape on the map clears the order",
    async ({ game: { page } }) => {
      const add = railButton(page, "Box select");
      const rally = railButton(page, "Choose rally point");
      await expect(add).toHaveAttribute("aria-pressed", "false");
      await expect(rail(page).locator(".army-action-rail__actions"), "no selection, no order buttons").toBeHidden();
      await add.click();
      await expect(add).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => mapCursor(page), "add mode cursor").toMatch(/^add .*army-add.*\.png/);
      await rally.click();
      await expect(rally).toHaveAttribute("aria-pressed", "true");
      await expect(add, "an order ends Box select").toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => mapCursor(page), "rally order cursor").toMatch(/^rally .*army-rally.*\.png/);
      await blur(page);
      await page.keyboard.press("Escape");
      await expect(rally).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => mapCursor(page), "Escape restores the map cursor").toBe("");
      await expect(railButton(page, "Cancel rally point"), "no banner planted").toBeHidden();
    });

  test("troop panel: opens, fits, keyboard Escape closes only the panel and refocuses Select troops",
    async ({ game: { page } }) => {
      const select = railButton(page, "Select troops");
      const panel = rail(page).locator(".army-action-rail__rally");
      await railButton(page, "Choose rally point").click();
      await select.click();
      await expect(panel).toBeVisible();
      await expect(select).toHaveAttribute("aria-expanded", "true");
      await expectInsideViewport(page, panel);
      const enabled = await panel.getByRole("checkbox").evaluateAll(boxes =>
        boxes.filter(box => !(box as HTMLInputElement).disabled).length);
      await expect(panel.locator(".army-action-rail__empty"), "empty note iff no free troops")
        .toBeVisible({ visible: enabled === 0 });
      await panel.getByRole("button", { exact: true, name: "Close troop selection" }).focus();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(select).toBeFocused();
      await expect(select).toHaveAttribute("aria-expanded", "false");
      await expect(railButton(page, "Choose rally point"), "the panel's Escape keeps the pending order")
        .toHaveAttribute("aria-pressed", "true");
      await select.click();
      await panel.getByRole("button", { exact: true, name: "Close troop selection" }).click();
      await expect(panel).toBeHidden();
      await blur(page);
      await page.keyboard.press("Escape");
      await expect(railButton(page, "Choose rally point")).toHaveAttribute("aria-pressed", "false");
    });
});
