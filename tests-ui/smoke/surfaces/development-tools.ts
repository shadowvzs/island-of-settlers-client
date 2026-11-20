import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { developmentPanel, expectInsideViewport, openDevelopmentCategory } from "../../fixtures/ui";

/** Icons may sit at most this far (px) off their button's centre. */
const CENTRE_TOLERANCE = 1;

/** Visible tool buttons of the open category: their sizes and icon offsets from the centre. */
const measureTools = (page: Page) => page.locator(".development-menu__item:visible").evaluateAll(items =>
  items.map(item => {
    const button = item.querySelector("button")!.getBoundingClientRect();
    const icon = item.querySelector("img")?.getBoundingClientRect();
    return {
      offset: icon ? Math.max(
        Math.abs(icon.left + icon.width / 2 - (button.left + button.width / 2)),
        Math.abs(icon.top + icon.height / 2 - (button.top + button.height / 2))) : 0,
      size: `${button.width}x${button.height}`
    };
  }));

/** Waves 1 and 5a: Development tools corner panel on the shared `Tabs` primitive. */
test.describe("development tools", () => {
  test("tabs follow the keyboard; tool buttons align; panel fits and closes", async ({ game: { page } }) => {
    await openDevelopmentCategory(page, "World");
    const panel = developmentPanel(page);
    const tabs = page.getByRole("tablist", { exact: true, name: "Development categories" }).getByRole("tab");
    const names = await tabs.allTextContents();
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.first(), "arrows wrap").toBeFocused();
    for (const name of names) {
      await openDevelopmentCategory(page, name);
      await expectInsideViewport(page, panel);
      const tools = await measureTools(page);
      expect(new Set(tools.map(tool => tool.size)).size, `${name}: one tool button size`).toBeLessThanOrEqual(1);
      for (const tool of tools) expect(tool.offset, `${name}: icon centred`).toBeLessThanOrEqual(CENTRE_TOLERANCE);
    }
    await openDevelopmentCategory(page, "Economy");
    await expect(panel.getByRole("button", { exact: true, name: "Reset carriers and horses" })).toBeVisible();
    await openDevelopmentCategory(page, "Diagnostics");
    await expect(panel.getByRole("button", { exact: true, name: "Export game" })).toBeVisible();
    await expect(panel.getByRole("button", { exact: true, name: "Import game" })).toBeVisible();
    await expect(panel.getByRole("button", { exact: true, name: "Clear saves" })).toBeVisible();
    await expect(panel.getByRole("button", { exact: true, name: "Recreate database" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await openDevelopmentCategory(page, "World");
    await page.getByRole("button", { exact: true, name: "Close development tools panel" }).click();
    await expect(panel).toBeHidden();
  });
});
