import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { developmentPanel, findMapPoint, nextFrames, openDevelopmentCategory } from "../../fixtures/ui";

const row = (page: Page) => page.locator(".settings__buttons");
const cornerButton = (page: Page, name: string) => row(page).getByRole("button", { exact: true, name });
const cameraPanel = (page: Page) => page.locator(".camera-controls-panel");

/** The top right icon row and its panel frames are React (mounted once the island is shown). */
test.describe("corner row", () => {
  test("theme leads the row; Settings is hidden beside the HUD; icons load", async ({ game: { page } }) => {
    const buttons = row(page).getByRole("button");
    await expect(buttons).toHaveCount(3);
    await expect(buttons.first()).toHaveClass(/hud-theme-toggle/);
    await expect(buttons.first()).toHaveAttribute("aria-haspopup", "true");
    await expect(buttons.nth(1)).toHaveAccessibleName("Development tools");
    await expect(buttons.nth(2)).toHaveAccessibleName("Camera controls");
    const sizes = await buttons.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return `${Math.round(box.width)}x${Math.round(box.height)}`;
    }));
    expect(new Set(sizes).size, "theme, development and camera share one button size").toBe(1);
    expect(sizes[0]).toBe("40x40");
    await expect(row(page).locator('[aria-label="Settings"]'), "the HUD Menu opens Settings").toBeHidden();
    for (const image of await row(page).locator("img, image").all()) {
      expect(await image.evaluate(node => node.tagName === "image" || (node as HTMLImageElement).naturalWidth > 0),
        "corner icon loaded").toBe(true);
    }
  });

  test("keyboard opens one panel at a time; Escape and an outside press close it", async ({ game: { page } }) => {
    const development = cornerButton(page, "Development tools");
    const camera = cornerButton(page, "Camera controls");
    await development.focus();
    await page.keyboard.press("Enter");
    await expect(developmentPanel(page)).toBeVisible();
    await expect(development).toHaveAttribute("aria-expanded", "true");
    await expect(development).toHaveClass(/is-active/);
    await camera.focus();
    await page.keyboard.press("Space");
    await expect(cameraPanel(page)).toBeVisible();
    await expect(developmentPanel(page), "one corner panel at a time").toBeHidden();
    await expect(development).toHaveAttribute("aria-expanded", "false");
    await expect(camera).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(cameraPanel(page)).toBeHidden();
    await expect(camera).toHaveAttribute("aria-expanded", "false");
    await camera.click();
    await expect(cameraPanel(page)).toBeVisible();
    await camera.click();
    await expect(cameraPanel(page), "the same button closes its panel").toBeHidden();
    await development.click();
    await nextFrames(page);
    const outside = await findMapPoint(page);
    await page.mouse.click(outside.x, outside.y);
    await expect(developmentPanel(page), "an outside press closes it").toBeHidden();
  });

  test("Show info opens the info window from Diagnostics and shows its pressed state", async ({ game: { page } }) => {
    const diagnostics = await openDevelopmentCategory(page, "Diagnostics");
    const info = diagnostics.getByRole("button", { exact: true, name: "Show info" });
    const pressed = await info.getAttribute("aria-pressed");
    const window = page.locator(".stats-overlay");
    const opened = pressed !== "true";
    await info.click();
    await expect(developmentPanel(page), "Development tools closes").toBeHidden();
    await expect(window).toBeVisible({ visible: opened });
    await openDevelopmentCategory(page, "Diagnostics");
    await expect(info).toHaveAttribute("aria-pressed", String(opened));
    await info.click();
    await expect(window).toBeVisible({ visible: !opened });
    await openDevelopmentCategory(page, "Diagnostics");
    await expect(info).toHaveAttribute("aria-pressed", String(!opened));
  });
});
