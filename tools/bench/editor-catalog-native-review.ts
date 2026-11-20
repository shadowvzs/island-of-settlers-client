import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Native standalone editor/catalog shell review: exactly three authoring buttons, no game HUD or
 * settlement runtime, working toggles, and High/Minimal desktop/narrow layouts.
 *
 * Run: npx tsx tools/bench/editor-catalog-native-review.ts
 */
const output = resolve(import.meta.dirname,
  "../../../resources/project-reviews/editor-catalog-2026-10-30");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"] as const) for (const viewport of [
    { name: "desktop", width: 1280, height: 820 },
    { name: "narrow", width: 420, height: 860 }
  ] as const) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    try {
      await page.goto(`${url}editor.html?quality=${quality}&size=256&seed=123&cache=0`);
      await page.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 240_000 });
      await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
      const before = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>("#editor-bar button")];
        return {
          boot: Boolean((window as any).__editorHooks),
          settlement: Boolean((window as any).__settlement),
          buttons: buttons.map(button => ({ action: button.dataset.editorAction,
            label: button.getAttribute("aria-label"), pressed: button.getAttribute("aria-pressed"),
            width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
          visibleGameHud: [".player-hud", ".settlement-ui", ".settlement-toast", "[data-settlement]"]
            .flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]
              .map(element => ({ selector, display: getComputedStyle(element).display,
                text: element.textContent?.trim() ?? "", rect: element.getBoundingClientRect().toJSON() })))
            .filter(element => element.display !== "none" && element.rect.width > 0 && element.rect.height > 0),
          hiddenGameHosts: [".player-hud", ".settlement-ui", ".settlement-toast", "[data-settlement]"]
            .flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]
              .map(element => ({ selector, display: getComputedStyle(element).display,
                text: element.textContent?.trim() ?? "" })))
            .filter(element => element.display === "none"),
          title: document.title,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth
        };
      });
      assert.equal(before.boot, true, `${quality}/${viewport.name}: editor hooks missing`);
      assert.equal(before.settlement, false, `${quality}/${viewport.name}: settlement runtime created in editor`);
      assert.equal(before.buttons.length, 3, `${quality}/${viewport.name}: expected exactly three editor buttons`);
      assert.deepEqual(before.buttons.map(button => button.action), ["editor", "generator", "minimap"]);
      assert.deepEqual(before.buttons.map(button => button.label), ["Map editor", "Map generator", "Minimap"]);
      assert(before.buttons.every(button => button.width >= 44 && button.height >= 44),
        `${quality}/${viewport.name}: touch target below 44px`);
      assert.deepEqual(before.visibleGameHud, [], `${quality}/${viewport.name}: game HUD leaked into editor`);
      assert(before.hiddenGameHosts.every(host => host.selector === ".settlement-ui" && host.text === ""),
        `${quality}/${viewport.name}: unexpected hidden game HUD`);
      assert(before.scrollWidth <= before.innerWidth + 1, `${quality}/${viewport.name}: page overflows`);
      await page.getByRole("button", { name: "Minimap", exact: true }).click();
      const minimap = await page.getByRole("button", { name: "Minimap", exact: true }).getAttribute("aria-pressed");
      await page.getByRole("button", { name: "Minimap", exact: true }).click();
      const minimapBack = await page.getByRole("button", { name: "Minimap", exact: true }).getAttribute("aria-pressed");
      assert.notEqual(minimap, minimapBack, `${quality}/${viewport.name}: minimap toggle did not change`);
      await page.getByRole("button", { name: "Map editor", exact: true }).click();
      const editorOff = await page.getByRole("button", { name: "Map editor", exact: true }).getAttribute("aria-pressed");
      await page.getByRole("button", { name: "Map editor", exact: true }).click();
      const editorOn = await page.getByRole("button", { name: "Map editor", exact: true }).getAttribute("aria-pressed");
      assert.notEqual(editorOff, editorOn, `${quality}/${viewport.name}: editor toggle did not change`);
      await page.getByRole("button", { name: "Map generator", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Map generator", exact: true })
        .getAttribute("aria-pressed"), "true", `${quality}/${viewport.name}: generator did not open`);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `${quality}-${viewport.name}.png`) });
      reports.push({ quality, viewport, before, toggles: { minimap, minimapBack, editorOff, editorOn }, errors });
      console.log(JSON.stringify({ quality, viewport: viewport.name, buttons: before.buttons.length,
        scrollWidth: before.scrollWidth, errors }));
    } finally { await page.close(); }
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
