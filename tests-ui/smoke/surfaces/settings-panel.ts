import { expect, test } from "../../fixtures/game";
import { expectInsideViewport, openSettings } from "../../fixtures/ui";

/** Wave 1: Settings corner panel (React sections mount on first open) from Menu > Settings. */
test.describe("settings panel", () => {
  test("opens with its five tabs, fits, closes on Escape and by its button",
    async ({ game: { page } }) => {
      const panel = await openSettings(page);
      const tabs = panel.getByRole("tablist", { exact: true, name: "Settings categories" }).getByRole("tab");
      await expect(tabs).toHaveText(["Graphics", "Appearance", "Sounds", "Hotkeys", "Misc"]);
      await expect(panel.getByRole("heading", { exact: true, name: "Graphics" })).toBeVisible();
      await expect(panel.getByRole("button", { exact: true, name: "Language" })).toHaveCount(0);
      await panel.getByRole("tab", { exact: true, name: "Sounds" }).click();
      for (const slider of ["Master volume", "Music volume", "Environment volume"])
        await expect(panel.getByRole("slider", { exact: true, name: new RegExp(`^${slider}:`) })).toBeVisible();
      await panel.getByRole("tab", { exact: true, name: "Misc" }).click();
      // A section heading's accessible name also holds its inline info button's label.
      for (const heading of ["Daylight", "World"])
        await expect(panel.getByRole("heading", { name: new RegExp(`^${heading}\\b`) })).toBeVisible();
      await expect(panel.getByRole("radio", { exact: true, name: "Nature (realistic)" })).toBeChecked();
      await expect(panel.getByRole("heading", { exact: true, name: "Time & weather" })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "Main selection" }), "the menu closes").toBeHidden();
      await expectInsideViewport(page, panel);
      expect((await panel.boundingBox())!.width, "corner panel width").toBeLessThanOrEqual(384);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await openSettings(page);
      await panel.getByRole("button", { exact: true, name: "Close settings panel" }).click();
      await expect(panel).toBeHidden();
    });

  test("keyboard changes a setting in place without closing the panel", async ({ game: { page } }) => {
    const panel = await openSettings(page);
    await panel.getByRole("tab", { exact: true, name: "Misc" }).click();
    const fog = panel.getByRole("checkbox", { exact: true, name: "Fog of war" });
    const checked = await fog.isChecked();
    await fog.focus();
    await page.keyboard.press("Space");
    await expect(fog).toBeChecked({ checked: !checked });
    await page.keyboard.press("Space");
    await expect(fog).toBeChecked({ checked });
    await expect(panel).toBeVisible();
  });
});
