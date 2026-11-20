import { expect, test } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";
import { expectInsideViewport } from "../fixtures/ui";

/**
 * Native acceptance for the standalone editor entry: the authoring panel is the page's own
 * surface, the gameplay HUD and settlement simulation are absent, and the bottom bar is exactly
 * editor / generator / minimap / campaign at both quality profiles.
 */
test("standalone editor opens with the four-button authoring HUD", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const quality = test.info().project.name.includes("high") ? "high" : "minimal";
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}editor.html?quality=${quality}&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean(window.__editorReady), null, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });

  await expect(page.locator("body")).toHaveClass(/editor-mode/);
  const bar = page.locator("#editor-bar");
  await expect(bar).toHaveAttribute("aria-label", "Editor tools");
  await expect(bar.locator("button")).toHaveCount(4);
  await expect(bar.locator("[data-editor-action]")).toHaveCount(4);
  await expect(bar.locator("[data-editor-action=campaign]")).toHaveAttribute("aria-label", "Campaign editor");
  await expect(bar.locator("[data-editor-action=editor]")).toHaveAttribute("aria-pressed", "true");
  await expect(bar.locator("[data-editor-action=generator]")).toHaveCount(1);
  await expect(bar.locator("[data-editor-action=minimap]")).toHaveAttribute("aria-pressed", "true");
  await expectInsideViewport(page, bar);

  const editor = page.getByRole("complementary", { exact: true, name: "Map editor" });
  await expect(editor).toBeVisible();
  await expectInsideViewport(page, editor);
  await expect(page.locator(".player-hud")).toBeHidden();
  await expect(page.locator(".settlement-ui")).toBeHidden();
  await expect(page.locator(".main-panel")).toBeHidden();
  await expect(page.locator(".stats")).toBeHidden();
  expect(await page.evaluate(() => (window as Window & { __settlement?: unknown }).__settlement))
    .toBeUndefined();

  const minimap = page.locator(".minimap");
  await expect(minimap).toBeVisible();
  await expect(minimap.getByRole("button", { name: "Show occupied territory" })).toHaveCount(0);
  await bar.locator("[data-editor-action=minimap]").click();
  await expect(minimap).toBeHidden();
  await bar.locator("[data-editor-action=minimap]").click();
  await expect(minimap).toBeVisible();

  await bar.locator("[data-editor-action=editor]").click();
  await expect(editor).toBeHidden();
  await bar.locator("[data-editor-action=editor]").click();
  await expect(editor).toBeVisible();

  expect(errors).toEqual([]);
});
