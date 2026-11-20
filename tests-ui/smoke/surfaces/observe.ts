import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectFocusInside, expectInsideViewport } from "../../fixtures/ui";

const observeWindow = (page: Page) => page.locator(".settlement-ui__observation-window");

const WATCH_LAUNCHERS = {
  ship: "Inspect a visible ship",
  worker: "Inspect a worker without issuing an order"
} as const;

/** Camera panel > Watch worker / ship (React launchers): Observe opens in picking mode, the panel closes. */
const startPicking = async (page: Page, kind: keyof typeof WATCH_LAUNCHERS = "worker") => {
  const camera = page.getByRole("button", { exact: true, name: "Camera controls" });
  await camera.click();
  await page.getByRole("button", { exact: true, name: WATCH_LAUNCHERS[kind] }).click();
  await expect(observeWindow(page)).toBeVisible();
  await expect(observeWindow(page).getByRole("status"))
    .toHaveText(new RegExp(`^Select a visible ${kind} on the island`));
  await expect(page.locator(".camera-controls-panel"), "the camera panel closes").toBeHidden();
  await expect(camera).toHaveAttribute("aria-expanded", "false");
};

/** Wave 3d: Observe window (React content; picking, follow and route stay in TypeScript). */
test.describe("observe window", () => {
  test("Escape cancels picking first and the window closes", async ({ game: { page } }) => {
    await startPicking(page);
    await expectFocusInside(observeWindow(page));
    await expectInsideViewport(page, observeWindow(page));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await expect(observeWindow(page), "Escape cancels picking even with focus outside").toBeHidden();
  });

  test("picking swallows map clicks; nothing to follow before a pick; close button and Escape close",
    async ({ game: { page } }) => {
      await startPicking(page);
      const panel = observeWindow(page);
      const canvas = page.locator("canvas").first();
      const box = (await canvas.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
      await expect(panel.getByRole("status"), "an empty tap keeps picking").toHaveText(/^Select a visible worker/);
      await expect(page.locator('[role="dialog"]:visible'), "no game click handler opened a window").toHaveCount(1);
      const follow = panel.getByRole("button", { exact: true, name: "Follow this worker or ship" });
      await expect(follow, "nothing to follow yet").toBeDisabled();
      await expect(panel.getByRole("button", { exact: true, name: "Stop following" })).toBeDisabled();
      await page.getByRole("button", { exact: true, name: "Close observe window" }).click();
      await expect(panel).toBeHidden();
      await startPicking(page, "ship");
      await page.keyboard.press("Escape");
      await expect(panel, "Escape with focus inside cancels picking and closes").toBeHidden();
    });
});
