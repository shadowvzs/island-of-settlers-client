import type { Page } from "@playwright/test";

import { expect, test } from "../../fixtures/game";
import { expectFocusInside, expectInsideViewport, expectKeyboardMove } from "../../fixtures/ui";

/**
 * Wave 2b: the quest book only the browser shows: the HUD entry point loads the lazy React content,
 * focus lands in the window, it fits and moves by keyboard, the tab list follows the arrow keys,
 * every open starts on the first quest again, and Escape closes it through the settlement root
 * (focus returns to Build). Rows, labels and claim states are vitest (`settlement-quests`).
 */
const questBook = (page: Page) => page.getByRole("dialog", { exact: true, name: "Quests" });

const openQuestBook = async (page: Page) => {
  await page.getByRole("button", { name: /^Quests(?::|$)/ }).click();
  const book = questBook(page);
  await expect(book.getByRole("tablist", { exact: true, name: "Open quests" })).toBeVisible();
  return book;
};

test.describe("quests", () => {
  test("open, focus, fit, move, arrow keys, reopen on the first quest, Escape", async ({ game: { page } }) => {
    const book = await openQuestBook(page);
    await expectFocusInside(book);
    await expectInsideViewport(page, book);
    await expectKeyboardMove(page, book, book.getByRole("button", {
      exact: true, name: "Move quests window. Drag or use arrow keys."
    }));
    const tabs = book.getByRole("tab");
    expect(await tabs.count(), "the fresh island offers several quests").toBeGreaterThan(1);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await expect(book.locator(".quest-window__claim")).toBeVisible();
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(tabs.first()).toBeFocused();
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
    await book.getByRole("button", { exact: true, name: "Close quests window" }).click();
    await expect(book).toBeHidden();
    await openQuestBook(page);
    await expect(tabs.first(), "every open starts on the first quest").toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await expect(book).toBeHidden();
    await expect(page.getByRole("button", { exact: true, name: "Build" })).toBeFocused();
  });
});
