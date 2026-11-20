import { expect, type Page, test } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";

/**
 * C6 browser acceptance: the campaign mode of `editor.html` reorders maps by drag and drop and places map nodes on
 * the campaign map view by pointer drag; Save persists both through the IndexedDB repository across a reload.
 * The page has no 3D island, so one quality project is enough.
 */
const openCampaignMode = async (page: Page) => {
  await page.goto(`${UI_TEST_URL}editor.html?mode=campaign`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 60_000 });
};

const nodeLeftPercent = (page: Page, name: RegExp) => page.getByRole("button", { name })
  .evaluate(element => Number.parseFloat((element as HTMLElement).style.left));

test("campaign mode: drag maps into order and nodes onto the map view; both persist", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only page: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept("Drag test"));
  await page.routeWebSocket("**/*", () => {});
  await openCampaignMode(page);
  await expect(page.locator("body")).toHaveClass(/campaign-editor-mode/);
  await expect(page.locator("#viewport")).toBeHidden();

  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByRole("tab", { name: "Maps" }).click();
  await page.getByRole("button", { exact: true, name: "Add map" }).click();
  await page.getByRole("button", { exact: true, name: "Add map" }).click();
  const rows = page.locator(".campaign-editor__map-row");
  await expect(rows).toHaveCount(2);
  await rows.nth(1).dragTo(rows.nth(0));
  await expect(rows.nth(0).locator(".campaign-editor__map-name")).toHaveText("Map 2");

  await page.getByRole("tab", { name: "Campaign map" }).click();
  const frame = (await page.locator(".campaign-editor__map-view").boundingBox())!;
  const node = (await page.getByRole("button", { name: /^Map 1: Map 2$/ }).boundingBox())!;
  await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.25, frame.y + frame.height * 0.8, { steps: 6 });
  await page.mouse.up();
  expect(await nodeLeftPercent(page, /^Map 1: Map 2$/)).toBeCloseTo(25, 0);
  await expect(page.locator(".campaign-editor__map-path")).toHaveCount(1);
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__editorReady));
  await page.getByRole("button", { name: /Drag test/ }).first().click();
  await page.getByRole("tab", { name: "Campaign map" }).click();
  expect(await nodeLeftPercent(page, /^Map 1: Map 2$/)).toBeCloseTo(25, 0);
  await page.getByRole("tab", { name: "Maps" }).click();
  await expect(page.locator(".campaign-editor__map-row .campaign-editor__map-name").first()).toHaveText("Map 2");
  expect(errors).toEqual([]);
});

test("campaign mode: Check lists problems, an entry jumps to its translation cell; table edits undo", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only page: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept("Check test"));
  await page.routeWebSocket("**/*", () => {});
  await openCampaignMode(page);
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByRole("tab", { name: "Maps" }).click();
  await page.getByRole("button", { exact: true, name: "Add map" }).click();

  await page.getByRole("tab", { name: "Ready check" }).click();
  await page.getByRole("button", { name: "Check the whole campaign" }).click();
  const sections = page.locator(".campaign-check__section");
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(1).locator("summary")).toContainText("Map 1");
  await expect(sections.nth(1).locator("summary")).toContainText("1 error");
  await sections.first().getByRole("button", { name: "name has no de translation." }).click();
  await expect(page.getByRole("tab", { name: "Translations" })).toHaveAttribute("aria-selected", "true");
  const germanName = page.getByRole("textbox", { exact: true, name: "Name (Deutsch)" }).first();
  await expect(germanName).toBeFocused();

  await page.keyboard.type("Prüfung");
  await expect(germanName).toHaveValue("Prüfung");
  await expect(germanName.locator("xpath=..")).toHaveAttribute("data-missing", "false");
  await page.getByLabel("Only missing").check();
  await expect(page.getByRole("textbox", { exact: true, name: "Name (English)" })).toHaveCount(2);
  await page.getByRole("button", { name: "Undo the last text edit" }).click();
  await expect(germanName).toHaveValue("");
  await expect(germanName.locator("xpath=..")).toHaveAttribute("data-missing", "true");
  await expect(page.getByRole("button", { name: "Undo the last text edit" })).toBeDisabled();
  const overflow = await page.evaluate(() => {
    const host = document.getElementById("campaign-editor")!;
    return host.scrollWidth > host.clientWidth + 1;
  });
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test("campaign mode: author a branch through exits and paths; the Check has no path problem", async ({ page }) => {
  test.skip(test.info().project.name !== "editor-minimal", "DOM-only page: no quality-dependent rendering");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => void dialog.accept("Branch test"));
  await page.routeWebSocket("**/*", () => {});
  await openCampaignMode(page);
  await page.getByRole("button", { name: "New campaign" }).click();
  await page.getByRole("tab", { name: "Maps" }).click();
  for (let count = 0; count < 3; count++) await page.getByRole("button", { exact: true, name: "Add map" }).click();
  const selectMap = (name: string) => page.locator(".campaign-editor__map-name", { hasText: name }).click();
  const exitRow = (id: string) => page.locator(`.campaign-paths__exit[data-exit="${id}"]`);
  const removeLock = page.getByRole("button", { name: "Remove the unused previous-map lock" });

  await selectMap("Map 1");
  await page.getByRole("button", { name: "Add an exit" }).click();
  await expect(exitRow("victory").getByRole("checkbox", { name: "Map 2" })).toBeChecked();
  await exitRow("exit-1").getByRole("checkbox", { name: "Map 3" }).check();
  const deleteExit = exitRow("exit-1").getByRole("button", { name: "Delete exit \"Exit 1\"" });
  await expect(deleteExit).toBeDisabled();
  await expect(deleteExit).toHaveAttribute("title", "Exit \"Exit 1\" still leads to: Map 3.");
  await removeLock.click();
  await selectMap("Map 2");
  await exitRow("victory").getByRole("checkbox", { name: "Map 3" }).uncheck();
  await exitRow("victory").getByRole("checkbox", { name: "Campaign ends" }).check();
  await removeLock.click();
  await selectMap("Map 3");
  await expect(exitRow("victory").getByRole("checkbox", { name: "Campaign ends" })).toBeChecked();
  await removeLock.click();
  await expect(removeLock).toHaveCount(0);

  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page.getByRole("group", { name: "Start maps" }).getByRole("checkbox", { name: "Map 1" }))
    .toBeChecked();
  await page.getByRole("tab", { name: "Campaign map" }).click();
  await expect(page.locator(".campaign-editor__map-path")).toHaveCount(2);
  await expect(page.locator(".campaign-editor__map-ending")).toHaveCount(2);

  await page.getByRole("tab", { name: "Ready check" }).click();
  await page.getByRole("button", { name: "Check the whole campaign" }).click();
  await expect(page.locator(".campaign-check__section").first()).toBeVisible();
  await expect(page.locator(".campaign-check__group[data-category=\"path\"]")).toHaveCount(0);
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  expect(errors).toEqual([]);
});
