import { expect, test } from "../../fixtures/game";
import { developmentPanel, expectInsideViewport, openDevelopmentCategory } from "../../fixtures/ui";

/** Wave 1: map generator corner panel (lazy React form) from Development tools > World. */
test.describe("map generator", () => {
  test("opens from Development tools, shows the island and the form, fits, closes on Escape",
    async ({ game: { page } }) => {
      const world = await openDevelopmentCategory(page, "World");
      await world.getByRole("button", { exact: true, name: "Map generator" }).click();
      await expect(developmentPanel(page), "one corner panel at a time").toBeHidden();
      const panel = page.locator(".settings-panel").filter({
        has: page.getByRole("heading", { exact: true, name: "New island" })
      });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("heading", { exact: true, name: "Current island" })).toBeVisible();
      await expect(panel.getByRole("button", { exact: true, name: "Recreate island" })).toBeVisible();
      await expectInsideViewport(page, panel);
      const width = panel.getByRole("combobox", { exact: true, name: "Width" });
      await width.focus();
      await page.keyboard.press("ArrowDown");
      await expect(width, "form controls keep keyboard focus").toBeFocused();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });
});
