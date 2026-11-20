import { expect, test } from "../../fixtures/game";
import { developmentPanel, expectInsideViewport, openDevelopmentCategory } from "../../fixtures/ui";

/** Wave 4: map editor panel (lazy React tabs) toggled from Development tools > World. */
test.describe("map editor", () => {
  test("toggles from Development tools, tabs follow the keyboard, fits the screen", async ({ game: { page } }) => {
    const world = await openDevelopmentCategory(page, "World");
    const toggle = world.getByRole("button", { exact: true, name: "Map editor" });
    await toggle.click();
    await expect(developmentPanel(page), "Development tools closes").toBeHidden();
    const editor = page.getByRole("complementary", { exact: true, name: "Map editor" });
    await expect(editor).toBeVisible();
    const tabs = editor.getByRole("tablist", { exact: true, name: "Map editor categories" }).getByRole("tab");
    await expect(tabs).toHaveCount(8);
    await expect(editor.getByRole("button", { exact: true, name: "Undo (Ctrl+Z)" })).toBeDisabled();
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(editor.getByRole("tabpanel")).toBeVisible();
    await page.keyboard.press("Home");
    await expect(tabs.first()).toBeFocused();
    await expectInsideViewport(page, editor);
    const units = editor.getByRole("tab", { name: "Units and camps" });
    await units.click();
    const unitsPanel = editor.getByRole("tabpanel");
    await expect(unitsPanel.getByText("Enemies need an adventure or colony scenario")).toBeVisible();
    await expect(unitsPanel.getByLabel("Enemy faction")).toHaveCount(0);
    await expect(unitsPanel.getByRole("button", { exact: true, name: "Switch scenario to adventure" })).toBeVisible();
    await editor.getByRole("button", { exact: true, name: "Close map editor" }).click();
    await expect(editor).toBeHidden();
    await openDevelopmentCategory(page, "World");
    await expect(toggle, "The Development toggle follows the panel's Close button").toHaveAttribute("aria-pressed",
      "false");
    await toggle.click();
    await expect(editor).toBeVisible();
    await openDevelopmentCategory(page, "World");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await toggle.click();
    await expect(editor).toBeHidden();
  });
});
