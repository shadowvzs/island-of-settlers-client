import { expect, type Page, test } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";

/**
 * TRG11 browser acceptance: an owner example authored in the Script workspace without typing an id — "when a
 * Player 1 soldier enters a region picked on the map, show a notice" — through the "+" lists, the family picker and
 * pick on map; then a template insert. Both leave the script Ready. DOM work: one quality project is enough.
 */
const script = (page: Page) => page.locator(".script-workspace-window");
const dialog = (page: Page) => page.locator(".script-dialog");

const addFromList = async (page: Page, button: RegExp, option: RegExp) => {
  await script(page).getByRole("button", { name: button }).last().click();
  await dialog(page).locator(".script-add__option").filter({ hasText: option }).first().click();
};

test("script workspace: author a trigger by pickers and pick on map, insert a template", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only workspace: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}editor.html?quality=minimal&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 180_000 });
  await page.getByRole("tab", { name: "Triggers, actors and templates" }).click();
  await page.getByRole("button", { name: "Open the script editor" }).click();
  await expect(script(page).getByRole("status")).toHaveText("Ready: no errors");

  await script(page).getByRole("button", { exact: true, name: "+ Trigger" }).click();
  await addFromList(page, /^\+ event$/, /^\[subject\] enters \[region\]|enters \[region\]$/);
  await expect(script(page).locator(".script-list__errors")).toBeVisible();
  await script(page).locator(".script-form .script-slot").filter({ hasText: "choose…" }).first().click();
  await dialog(page).getByRole("tab", { name: "A family" }).click();
  await dialog(page).locator(".script-picker__tree button").filter({ hasText: /^Soldier/ }).click();
  await script(page).locator(".script-form .script-slot").filter({ hasText: "choose…" }).first().click();
  await dialog(page).getByRole("button", { name: "Pick on map" }).click();
  await expect(script(page)).toBeHidden();
  const canvas = (await page.locator("#view").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await expect(script(page)).toBeVisible();
  await addFromList(page, /^\+ action$/, /^show the notice/);
  await script(page).locator(".script-form .script-slot").filter({ hasText: "choose…" }).first().click();
  await dialog(page).getByLabel("Text (English)").fill("Welcome to the bay");
  await dialog(page).getByLabel("Text (Magyar)").fill("Üdv az öbölben");
  await dialog(page).getByRole("button", { name: "Choose" }).click();
  await expect(script(page).locator(".script-form__explain")).toContainText(
    "When Player 1's Soldier family");
  await expect(script(page).locator(".script-form__explain")).toContainText("show the notice “Welcome to the bay”");
  await expect(script(page).getByRole("status")).toHaveText("Ready: no errors");

  await script(page).getByRole("button", { name: "+ From template" }).click();
  await dialog(page).getByRole("button", { name: /^Kill counter/ }).click();
  await dialog(page).getByRole("button", { exact: true, name: "Insert" }).click();
  await expect(script(page).locator(".script-list__trigger")).toHaveCount(3);
  await expect(script(page).getByRole("status")).toHaveText("Ready: no errors");
  expect(errors).toEqual([]);
});

test("script workspace: a deep link opens the window on its tab", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only workspace: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}editor.html?quality=minimal&size=64&seed=123&cache=0&script=variables`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 180_000 });
  await expect(script(page)).toBeVisible();
  await expect(script(page).getByRole("tab", { name: "Variables" })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});

/** The dev build's `window.__scriptWindow` review hook, as far as these tests use it. */
interface ScriptWindowHook {
  workspace: {
    focusItem: (link: { itemId: string; path: string; tab: "triggers" }) => void;
    getSnapshot: () => { script: { triggers: { actions: { op?: string }[]; id: string }[] } };
  };
}

/** Review capture of the play-test (TEST_PLAY_CAPTURE = a PNG path): the game page then runs in Hungarian. */
const TEST_PLAY_CAPTURE = process.env.TEST_PLAY_CAPTURE;
const CAPTURE_SETTLE_MS = 4000;

test("script workspace: Test play opens the play-test with the script log", async ({ context, page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only workspace: no quality-dependent rendering");
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}editor.html?quality=minimal&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 180_000 });
  await page.getByRole("tab", { name: "Triggers, actors and templates" }).click();
  await page.getByRole("button", { name: "Open the script editor" }).click();
  await script(page).getByRole("button", { name: "+ From template" }).click();
  await dialog(page).getByRole("button", { name: /^Kill counter/ }).click();
  await dialog(page).getByRole("button", { exact: true, name: "Insert" }).click();
  await expect(script(page).getByRole("status")).toHaveText("Ready: no errors");
  if (TEST_PLAY_CAPTURE) await page.evaluate(() => localStorage.setItem("island-of-settlers.language", "hu"));

  const testPlay = script(page).getByRole("button", { name: /^Test play/ });
  await expect(testPlay).toHaveAttribute("title", /script log/);
  const [game] = await Promise.all([page.waitForEvent("popup"), testPlay.click()]);
  game.on("pageerror", error => errors.push(error.message));
  await game.waitForURL(/testPlay=1/);
  expect(new URL(game.url()).searchParams.get("map")).toBe("test-play");
  await expect(page.locator(".script-workspace-window")).toBeVisible();

  const log = game.locator(".test-play-log");
  await expect(log).toBeVisible({ timeout: 240_000 });
  await expect(log.locator(".test-play-log__row[data-kind='run']").first())
    .toContainText("fired by mapStarted", { timeout: 120_000 });
  await expect(log.locator(".test-play-log__row[data-kind='step']").first()).toContainText("activateQuest");
  await expect(log.locator(".test-play-log__row[data-kind='quest']").first()).toContainText("inactive → active");
  await expect(log.locator(".test-play-log__time").first()).toHaveText(/^\d\d:\d\d$/);
  if (TEST_PLAY_CAPTURE) {
    await expect(game.locator(".settlement-ui").first()).toBeVisible({ timeout: 120_000 });
    await game.waitForTimeout(CAPTURE_SETTLE_MS);
    await game.screenshot({ path: TEST_PLAY_CAPTURE });
  }
  await log.getByRole("button", { name: "Run steps" }).click();
  await expect(log.locator(".test-play-log__row[data-kind='step']")).toHaveCount(0);
  await expect(log.locator(".test-play-log__row[data-kind='run']").first()).toBeVisible();
  await log.getByRole("button", { name: "Collapse the script log" }).click();
  await expect(log.locator(".test-play-log__list")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("script workspace: a deep link marks the row and slot of its field path", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only workspace: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}editor.html?quality=minimal&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 180_000 });
  await page.getByRole("tab", { name: "Triggers, actors and templates" }).click();
  await page.getByRole("button", { name: "Open the script editor" }).click();
  await script(page).getByRole("button", { name: "+ From template" }).click();
  await dialog(page).getByRole("button", { name: /^Kill counter/ }).click();
  await dialog(page).getByRole("button", { exact: true, name: "Insert" }).click();
  // The page keeps its unsaved script: the dev review hook applies the link the Check panel's jump would carry.
  await page.evaluate(() => {
    const { workspace } = (window as unknown as { __scriptWindow: ScriptWindowHook }).__scriptWindow;
    const start = workspace.getSnapshot().script.triggers.find(item => item.actions[0]?.op === "activateQuest")!;
    workspace.focusItem({ itemId: start.id, path: "actions[0].args.quest", tab: "triggers" });
  });
  await expect(script(page).locator(".script-row[data-linked='true']")).toHaveCount(1);
  await expect(script(page).locator(".script-row[data-linked='true'] .script-slot[data-linked='true']"))
    .toHaveCount(1);
  expect(errors).toEqual([]);
});
