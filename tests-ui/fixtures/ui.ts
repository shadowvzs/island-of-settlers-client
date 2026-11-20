import { expect, type Locator, type Page } from "@playwright/test";

export { openDevelopmentCategory } from "../../tools/bench/development-ui-helpers";

/** Phone projects: windows may span the whole width, so keyboard moves can be clamped. */
export const PHONE_WIDTH = 480;

/** Upper bound of stacked dialogs `resetUi` closes (guards against a close button that keeps its dialog). */
const MAX_OPEN_DIALOGS = 8;

/**
 * Closes what a case may have left open: dialogs by their close button, panels by Escape. Closers are
 * looked up again after each click: closing one dialog (e.g. Main selection) can hide another opener.
 */
export const resetUi = async (page: Page) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const closers = page.locator('[role="dialog"]:visible')
    .getByRole("button", { name: /^Close .* window$/ });
  for (let closed = 0; closed < MAX_OPEN_DIALOGS && await closers.count(); closed++)
    await closers.first().click();
  await page.keyboard.press("Escape");
};

/** Waits until the browser rendered twice (style, layout and focus fix-up are done). */
export const nextFrames = (page: Page) => page.evaluate(() => new Promise<void>(resolve =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

/**
 * Menu > Settings: the top right settings panel with its React sections. The Settings button hides
 * its own menu; until the browser moves focus off it, Escape still belongs to `.settlement-ui`.
 */
export const openSettings = async (page: Page) => {
  const panel = settingsPanel(page);
  if (await panel.isVisible()) return panel;
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(panel).toBeVisible();
  await nextFrames(page);
  return panel;
};

/** Menu: the main panel's Main selection view (Buildings ... Settings, Music player, Credits, Game News). */
export const openMainSelection = async (page: Page) => {
  const panel = page.getByRole("dialog", { exact: true, name: "Main selection" });
  if (await panel.isVisible()) return panel;
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(panel).toBeVisible();
  await nextFrames(page);
  return panel;
};

const settingsPanel = (page: Page) => page.locator(".settings-panel")
  .filter({ has: page.getByRole("button", { name: "Close settings panel", exact: true }) });

/** A point where the map canvas itself is on top (phones: the panel and HUD cover most of the screen). */
export const findMapPoint = (page: Page) => page.evaluate(() => {
  for (let y = innerHeight - 20; y > 0; y -= 20) {
    for (let x = 10; x < innerWidth; x += 20) {
      if (document.elementFromPoint(x, y) instanceof HTMLCanvasElement) return { x, y };
    }
  }
  throw new Error("no uncovered map point");
});

export const developmentPanel = (page: Page) => page.locator(".development-menu");

/**
 * The element lies inside the viewport and the page itself never scrolls sideways; `scrolls` is
 * for a surface that may be taller than a phone and scrolls vertically by design.
 */
export const expectInsideViewport = async (page: Page, element: Locator, scrolls = false) => {
  const box = await element.boundingBox();
  const { height, width } = page.viewportSize()!;
  expect(box, "element is rendered").not.toBeNull();
  expect(box!.x, "left edge inside").toBeGreaterThanOrEqual(0);
  expect(box!.y, "top edge inside").toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, "right edge inside").toBeLessThanOrEqual(width + 1);
  if (!scrolls) expect(box!.y + box!.height, "bottom edge inside").toBeLessThanOrEqual(height + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
};

export const expectFocusInside = async (element: Locator) => {
  expect(await element.evaluate(node => node.contains(document.activeElement)), "focus inside").toBe(true);
};

/**
 * A focused move handle shifts its window with the arrow keys (desktop) and the window stays on
 * screen; on phones a full-width window may be clamped in place.
 */
export const expectKeyboardMove = async (page: Page, frame: Locator, handle: Locator) => {
  await handle.focus();
  const before = (await frame.boundingBox())!;
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  let after = (await frame.boundingBox())!;
  if (after.x === before.x && after.y === before.y) {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    after = (await frame.boundingBox())!;
  }
  if (page.viewportSize()!.width > PHONE_WIDTH)
    expect(after.x !== before.x || after.y !== before.y, "arrow keys move the window").toBe(true);
  await expectInsideViewport(page, frame);
};
