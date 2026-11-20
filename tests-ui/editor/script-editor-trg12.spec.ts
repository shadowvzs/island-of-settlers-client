import { expect, type Page, test } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";

/**
 * TRG12 browser acceptance: a variable, a multiboard bound to it and a quest completed by a condition on it are
 * authored only through the Variables, Multiboards and Quests tabs and the typed pickers (no id typed); the script
 * ends Ready and the board's live preview shows the cell. DOM work: one quality project is enough.
 */
const script = (page: Page) => page.locator(".script-workspace-window");
const dialog = (page: Page) => page.locator(".script-dialog");
const status = (page: Page) => script(page).getByRole("status");
const READY = "Ready: no errors";

const openTab = (page: Page, name: string) => script(page).getByRole("tab", { exact: true, name }).click();

const chooseVariable = async (page: Page, slot: ReturnType<Page["locator"]>, name: RegExp) => {
  await slot.click();
  await dialog(page).getByRole("tab", { exact: true, name: "Variable" }).click();
  await dialog(page).getByRole("button", { name }).click();
};

test("script workspace: author a variable, a board and a quest by pickers, ending Ready", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only workspace: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}editor.html?quality=minimal&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 180_000 });
  await page.getByRole("tab", { name: "Triggers, actors and templates" }).click();
  await page.getByRole("button", { name: "Open the script editor" }).click();
  await expect(status(page)).toHaveText(READY);

  await openTab(page, "Variables");
  await script(page).getByRole("button", { exact: true, name: "+ Variable" }).click();
  const name = script(page).locator(".script-variable").first().getByLabel("Name", { exact: true });
  await name.fill("trees");
  await name.blur();
  await expect(script(page).locator(".script-variable").first()).toContainText("Not used yet");

  await openTab(page, "Multiboards");
  await script(page).getByRole("button", { exact: true, name: "+ Board" }).click();
  await script(page).getByRole("button", { exact: true, name: "+ Column" }).click();
  await expect(status(page)).not.toHaveText(READY);
  const newCell = script(page).locator(".script-board__column").last().locator(".script-slot");
  await chooseVariable(page, newCell, /^trees \(number\)$/);
  // Ready; the only note is "board not shown by any action yet" until the quest shows it.
  await expect(status(page)).toHaveText(/^Ready/);
  await expect(script(page).locator(".script-board__preview .multiboard")).toContainText("New board");

  await openTab(page, "Quests");
  await script(page).getByRole("button", { exact: true, name: "+ Quest" }).click();
  await script(page).getByLabel("Completed when").selectOption("condition");
  await script(page).locator(".script-quest").getByRole("button", { exact: true, name: "+ condition" }).first()
    .click();
  await dialog(page).locator(".script-add__option").filter({ hasText: /^\[first value\]/ }).first().click();
  const operands = script(page).locator(".script-quest .script-slot").filter({ hasText: "choose…" });
  await chooseVariable(page, operands.first(), /^trees \(number\)$/);
  await operands.first().click();
  await dialog(page).getByRole("tab", { exact: true, name: "Value" }).click();
  await dialog(page).locator(".script-picker__input input").fill("5");
  await dialog(page).getByRole("button", { exact: true, name: "Choose" }).click();
  const activate = script(page).locator(".script-quest .script-form__section").filter({ hasText: "When it starts" });
  await activate.getByRole("button", { exact: true, name: "+ action" }).click();
  await dialog(page).locator(".script-add__option").filter({ hasText: /^show board/ }).first().click();
  await activate.locator(".script-slot").filter({ hasText: "choose…" }).first().click();
  await dialog(page).getByRole("button", { name: /board/ }).first().click();
  await expect(status(page)).toHaveText(READY);
  await expect(script(page).locator(".script-quest")).toContainText("trees");

  await openTab(page, "Variables");
  await expect(script(page).locator(".script-variable").first()).toContainText("quest “New quest”");
  expect(errors).toEqual([]);
});
