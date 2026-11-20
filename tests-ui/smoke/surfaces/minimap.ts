import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectInsideViewport, PHONE_WIDTH } from "../../fixtures/ui";

/** Colour components that must change when the territory mask is drawn over the minimap. */
const MIN_MASK_CHANGES = 50;

const canvasPixels = (page: Page) => page.locator(".minimap__canvas").evaluate((canvas: HTMLCanvasElement) =>
  [...canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data]);

const countChanged = (before: number[], after: number[]) =>
  before.filter((value, index) => value !== after[index]).length;

/**
 * Wave 5a: minimap (F1) with its DOM drag header and React title/territory toggle (a store the
 * imperative canvas redraw reads).
 */
test.describe("minimap", () => {
  test("Map shows it; header drags by mouse and keyboard; territory toggle stays put", async ({ game }) => {
    const { page } = game;
    const map = page.getByRole("button", { exact: true, name: "Map" });
    const minimap = page.locator(".minimap");
    await map.click();
    await expect(minimap).toBeVisible();
    await expect(map).toHaveAttribute("aria-pressed", "true");
    await expectInsideViewport(page, minimap);
    const header = page.locator(".minimap__header");
    const start = (await minimap.boundingBox())!;
    const handle = (await header.boundingBox())!;
    const phone = game.screen.width <= PHONE_WIDTH;
    const shift = phone ? { x: -40, y: -60 } : { x: -160, y: -120 };
    await page.mouse.move(handle.x + 40, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40 + shift.x, handle.y + handle.height / 2 + shift.y, { steps: 6 });
    await page.mouse.up();
    const dragged = (await minimap.boundingBox())!;
    expect(dragged.x !== start.x || dragged.y !== start.y, "mouse drag moves the minimap").toBe(true);
    expect(dragged.width).toBe(start.width);
    await expectInsideViewport(page, minimap);
    await header.focus();
    await page.keyboard.press("ArrowRight");
    const moved = (await minimap.boundingBox())!;
    if (phone) expect(moved.x, "arrow key moves right or is clamped").toBeGreaterThanOrEqual(dragged.x);
    else expect(moved.x, "arrow key moves 12 px").toBeCloseTo(dragged.x + 12, 0);
    const territory = minimap.getByRole("button", { exact: true, name: "Show occupied territory" });
    const pressed = await territory.getAttribute("aria-pressed");
    const before = await canvasPixels(page);
    await territory.click();
    await expect(territory).not.toHaveAttribute("aria-pressed", pressed ?? "false");
    await expect.poll(async () => countChanged(before, await canvasPixels(page)), "territory mask redraws")
      .toBeGreaterThan(MIN_MASK_CHANGES);
    expect(await minimap.boundingBox(), "toggle press does not drag").toEqual(moved);
    await territory.click();
    await map.click();
    await expect(minimap).toBeHidden();
  });
});
