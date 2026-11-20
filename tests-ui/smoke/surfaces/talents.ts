import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectFocusInside, expectInsideViewport, expectKeyboardMove } from "../../fixtures/ui";

/**
 * TALENT-01: the talents window only the browser shows: the HUD button loads the lazy React tree,
 * focus lands in it, it fits (scrolling on phones) and moves by keyboard; a locked talent explains
 * its level by tap (status line and whole-button tooltip), a point placed stays pending until Reset gives it
 * back for free, Escape closes the window and an unapplied point is gone when it reopens. Labels,
 * gates and states are vitest (`talent-window`).
 */
const talentsWindow = (page: Page) => page.getByRole("dialog", { exact: true, name: "Talents" });

test.describe("talents", () => {
  test("open, fit, move, locked tooltip on tap, pending point, free reset, Escape discards", async ({
    game: { page }
  }) => {
    const openButton = page.getByRole("button", { name: /^Talents(?::|$)/ });
    await openButton.click();
    const dialog = talentsWindow(page);
    const production = dialog.locator('[data-talent="productionSpeed"]');
    await expect(production).toBeVisible();
    await expectFocusInside(dialog);
    await expectInsideViewport(page, dialog);
    await expectKeyboardMove(page, dialog, dialog.getByRole("button", {
      exact: true, name: "Move talents window. Drag or use arrow keys."
    }));
    const locked = dialog.locator('[data-talent="soldierStrength"]');
    await expect(locked).toHaveClass(/talents__card--locked/);
    // aria-disabled: still tappable, it explains why it is locked.
    await locked.locator(".talents__raise").click({ force: true });
    await expect(dialog.getByRole("status")).toContainText("Requires level 50");
    await expect(dialog.locator(".info-tooltip__button")).toHaveCount(0);
    await expect(locked.getByRole("tooltip")).toContainText(/Requires level 50 \(you are level \d+\)/);
    await production.locator(".talents__raise").click();
    await expect(production).toHaveClass(/talents__card--pending/);
    await dialog.getByRole("button", { exact: true, name: "Reset pending" }).click();
    await expect(production).not.toHaveClass(/talents__card--pending/);
    await production.locator(".talents__raise").click();
    await page.keyboard.press("Escape");
    await expect(production.getByRole("tooltip")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await openButton.click();
    await expect(production).not.toHaveClass(/talents__card--pending/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
});
