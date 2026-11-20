import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import {
  expectFocusInside, expectInsideViewport, expectKeyboardMove, openDevelopmentCategory, openMainSelection
} from "../../fixtures/ui";

/**
 * Waves 1–2: the lazy React windows on the shared frame (`createLazyReactWindow`). Each opens from
 * its real entry point, loads its content, takes focus, fits the screen, moves by keyboard, closes on
 * Escape without closing the panel it came from (Escape chain step 4) and returns focus to the
 * opener; windows with `resetScrollOnOpen` start at the top again on every opening.
 */
interface LazyWindowCase {
  /** A child that exists only once the lazy React content rendered. */
  content: (dialog: Locator) => Locator;
  /** Opens the panel holding the opener and returns that panel. */
  entry: (page: Page) => Promise<Locator>;
  name: string;
  /** Selector of the scrolling body when the window resets its scroll on open. */
  scrollBody?: string;
}

const fromMainSelection = (page: Page) => openMainSelection(page);

const CASES: LazyWindowCase[] = [
  {
    content: dialog => dialog.getByRole("radiogroup", { name: "Gender", exact: true }),
    entry: fromMainSelection, name: "Customization"
  },
  {
    content: dialog => dialog.locator(".credits-entry").first(),
    entry: fromMainSelection, name: "Credits", scrollBody: ".credits-window__body"
  },
  {
    content: dialog => dialog.locator("article").first(),
    entry: fromMainSelection, name: "Game News", scrollBody: ".developer-diary__body"
  },
  {
    content: dialog => dialog.getByRole("combobox", { name: "Language", exact: true }),
    entry: fromMainSelection, name: "Language"
  },
  {
    content: dialog => dialog.getByRole("listbox", { name: "Music playlist", exact: true }),
    entry: fromMainSelection, name: "Music player"
  },
  {
    content: dialog => dialog.locator(".military-benchmark-window__body > *").first(),
    entry: page => openDevelopmentCategory(page, "Military"), name: "Historical military benchmark"
  }
];

const windowOf = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });

const openWindow = async (page: Page, entry: Locator, name: string) => {
  await entry.getByRole("button", { name, exact: true }).click();
  await expect(windowOf(page, name)).toBeVisible();
};

const checkScrollReset = async (page: Page, dialog: Locator, entry: Locator, item: LazyWindowCase) => {
  const body = dialog.locator(item.scrollBody!);
  const scrolled = await body.evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
  expect(scrolled, "content is long enough to scroll").toBeGreaterThan(0);
  await dialog.getByRole("button", { name: `Close ${item.name.toLowerCase()} window`, exact: true }).click();
  await expect(dialog).toBeHidden();
  await openWindow(page, entry, item.name);
  expect(await body.evaluate(node => node.scrollTop), "scroll resets on reopen").toBe(0);
};

test.describe("lazy windows", () => {
  for (const item of CASES) {
    test(`${item.name}: open, focus, fit, move, Escape, reopen`, async ({ game: { page } }) => {
      const entry = await item.entry(page);
      const opener = entry.getByRole("button", { name: item.name, exact: true });
      await openWindow(page, entry, item.name);
      const dialog = windowOf(page, item.name);
      await expect(item.content(dialog)).toBeVisible();
      await expectFocusInside(dialog);
      await expectInsideViewport(page, dialog);
      const handle = dialog.getByRole("button", {
        exact: true, name: `Move ${item.name.toLowerCase()} window. Drag or use arrow keys.`
      });
      await expectKeyboardMove(page, dialog, handle);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(opener, "Escape returns focus to the opener").toBeFocused();
      await expect(entry, "Escape closes this window only").toBeVisible();
      await openWindow(page, entry, item.name);
      if (item.scrollBody) await checkScrollReset(page, dialog, entry, item);
      await dialog.getByRole("button", { name: `Close ${item.name.toLowerCase()} window`, exact: true }).click();
      await expect(dialog).toBeHidden();
    });
  }
});
