import { routeHealthyBackend } from "../../../tools/bench/test-backend";
import { expect, test } from "../../fixtures/game";
import { UI_TEST_URL } from "../../fixtures/server";
import { expectInsideViewport } from "../../fixtures/ui";

/**
 * Wave 2: the account start scroll (React on first open). It shows before any island loads, so it
 * gets its own short-lived page (`?login=1` forces it in automated browsers) and no game load. Accounts
 * exist only with an available backend: the page answers the backend probe as healthy.
 */
test.describe("account scroll", () => {
  test("opens on sign in, moves focus to errors, switches to register, fits", async ({ browser, game }) => {
    const page = await browser.newPage({ viewport: game.screen });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await routeHealthyBackend(page);
    await page.goto(`${UI_TEST_URL}?login=1&size=64&seed=123&cache=0`);
    const scroll = page.getByRole("dialog", { exact: true, name: "Island of Settlers" });
    await expect(scroll).toBeVisible({ timeout: 30_000 });
    const email = scroll.getByRole("textbox", { name: /^Email/ });
    await expect(email, "sign in opens first and focuses its first field").toBeFocused();
    // The scroll may be taller than a phone; it scrolls vertically, never sideways.
    await expectInsideViewport(page, scroll, true);
    await scroll.getByRole("button", { exact: true, name: "Sign in" }).click();
    await expect(email, "an invalid submit focuses the first error").toBeFocused();
    await scroll.getByRole("button", { exact: true, name: "Register" }).click();
    const displayName = scroll.getByRole("textbox", { name: /^Display name/ });
    await expect(displayName, "register focuses its first field").toBeFocused();
    await scroll.getByRole("button", { exact: true, name: "Register" }).click();
    await expect(displayName, "an invalid registration focuses the first error").toBeFocused();
    await expectInsideViewport(page, scroll, true);
    expect(errors).toEqual([]);
    await page.close();
  });

  test("offers all eight nation helmets with canonical tooltips and keyboard state", async ({ browser, game }) => {
    const page = await browser.newPage({ viewport: game.screen });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await routeHealthyBackend(page);
    await page.goto(`${UI_TEST_URL}?login=1&size=64&seed=123&cache=0`);
    const scroll = page.getByRole("dialog", { exact: true, name: "Island of Settlers" });
    await expect(scroll).toBeVisible({ timeout: 30_000 });
    await scroll.getByRole("button", { exact: true, name: "Register" }).click();
    const picker = scroll.locator('.race-picker[role="radiogroup"]');
    const options = picker.locator(".race-picker__option");
    await expect(options).toHaveCount(8);
    await expectInsideViewport(page, picker, true);
    const nations = await options.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-nation")));
    expect(nations).toEqual(["roman", "viking", "japanese", "nubian", "indigenous", "chinese", "persian", "maya"]);
    await expect.poll(async () => options.locator("img").evaluateAll(images =>
      images.map(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)))
      .toEqual(Array(8).fill(true));
    const helmetSizes = await options.locator("img").evaluateAll(images =>
      images.map(image => (image as HTMLImageElement).naturalWidth));
    expect(helmetSizes.every(width => width > 0)).toBe(true);
    const tooltips = await options.evaluateAll(nodes => nodes.map(node => node.getAttribute("title") ?? ""));
    expect(tooltips.every(tooltip => tooltip.length > 0)).toBe(true);
    await expect(options.nth(0)).toHaveAttribute("tabindex", "0");
    await expect(options.nth(1)).toHaveAttribute("tabindex", "-1");
    await options.nth(7).click();
    await expect(options.nth(7)).toHaveAttribute("aria-checked", "true");
    await expect(options.nth(0)).toHaveAttribute("aria-checked", "false");
    expect(errors).toEqual([]);
    await page.close();
  });

  test("never shows in standalone play, even when ?login=1 asks for it", async ({ browser, game }) => {
    const page = await browser.newPage({ viewport: game.screen });
    await page.routeWebSocket("**/*", () => {});
    await page.goto(`${UI_TEST_URL}?login=1&size=64&seed=123&cache=0`);
    await page.waitForFunction(() => Boolean(window.__islandReady), null, { timeout: 60_000 });
    await expect(page.getByRole("dialog", { exact: true, name: "Island of Settlers" })).toHaveCount(0);
    await page.close();
  });
});
