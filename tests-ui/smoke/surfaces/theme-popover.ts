import { expect, test } from "../../fixtures/game";
import { expectInsideViewport } from "../../fixtures/ui";

/** Wave 1: HUD theme popover (React radios on first open), owned by its DOM frame. */
test.describe("theme popover", () => {
  test("opens, switches mode by keyboard, closes on Escape and outside press", async ({ game }) => {
    const { page } = game;
    const toggle = page.getByRole("button", { exact: true, name: "Theme and style" });
    const popover = page.locator(".hud-theme-popover");
    await toggle.click();
    await expect(popover).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expectInsideViewport(page, popover);
    const mode = popover.getByRole("radiogroup", { exact: true, name: "Mode" });
    // The options are radio-role buttons: Enter / Space choose (no arrow-key roving today).
    await mode.getByRole("radio", { exact: true, name: "Dark" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-hud-theme", "dark");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await mode.getByRole("radio", { exact: true, name: "Light" }).focus();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-hud-theme", "light");
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(popover).toBeVisible();
    // On phones the popover covers most of the upper screen: press the map below (or beside) it.
    const box = (await popover.boundingBox())!;
    const below = box.y + box.height + 40;
    const outside = below < game.screen.height - 130 ? { x: game.screen.width / 2, y: below } : { x: 8, y: below - 80 };
    await page.mouse.click(outside.x, outside.y);
    await expect(popover, "an outside press closes it").toBeHidden();
  });
});
