import { expect, test } from "../../fixtures/game";
import { expectInsideViewport } from "../../fixtures/ui";

const CONTROLS = ["Zoom in", "Zoom out", "Move left", "Move right", "Move up", "Move down",
  "Rotate left", "Rotate right", "Pitch up", "Pitch down", "Cinematic camera (C)", "Reset camera"];

/** Wave 5a: camera corner panel (lazy React content, hold loops in TS services). */
test.describe("camera panel", () => {
  test("opens, shows every control with its icon, keeps the layout, fits, closes", async ({ game: { page } }) => {
    const toggle = page.getByRole("button", { exact: true, name: "Camera controls" });
    const panel = page.locator(".camera-controls-panel");
    await toggle.click();
    await expect(panel).toBeVisible();
    for (const name of CONTROLS) {
      const button = panel.getByRole("button", { exact: true, name });
      await expect(button).toBeVisible();
      expect(await button.locator("img").evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        return image.naturalWidth;
      }), `${name} icon loads`).toBeGreaterThan(0);
    }
    const pad = (await panel.getByRole("group", { exact: true, name: "Move camera" }).boundingBox())!;
    const rotate = (await panel.getByRole("group", { exact: true, name: "Rotate camera" }).boundingBox())!;
    expect(rotate.y, "rotation sits below the movement pad").toBeGreaterThanOrEqual(pad.y + pad.height - 1);
    await expectInsideViewport(page, panel);
    await panel.getByRole("button", { exact: true, name: "Reset camera" }).click();
    await expect(panel, "control clicks keep the panel open").toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await toggle.click();
    await panel.getByRole("button", { exact: true, name: "Close camera controls panel" }).click();
    await expect(panel).toBeHidden();
  });

  test("typing a bookmark name stays in the field (no camera shortcuts)", async ({ game: { page } }) => {
    await page.getByRole("button", { exact: true, name: "Camera controls" }).click();
    const name = page.getByRole("textbox", { exact: true, name: "Bookmark name" });
    const cinematic = page.getByRole("button", { exact: true, name: "Cinematic camera (C)" });
    const pressed = await cinematic.getAttribute("aria-pressed");
    await name.fill("");
    await name.pressSequentially("cove");
    await expect(name).toHaveValue("cove");
    await expect(cinematic, "C typed into the field does not toggle cinematic").toHaveAttribute(
      "aria-pressed", pressed ?? "false");
    await name.fill("");
  });
});
