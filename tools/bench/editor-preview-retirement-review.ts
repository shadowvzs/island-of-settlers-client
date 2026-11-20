import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Native editor preview/overlay retirement review. Opens the standalone editor, enables the map
 * editor, creates a brush preview, then retires the whole runtime while the preview is live and
 * checks that the editor canvas overlays, view canvas and DEV stats are gone.
 *
 * Run: npx tsx tools/bench/editor-preview-retirement-review.ts
 */
const output = resolve(import.meta.dirname,
  "../../../resources/project-reviews/editor-preview-retirement-2026-10-30");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const [quality, size] of [["high", 256], ["minimal", 512]] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/src/app/editor-main.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("const hooks = runtime.editorHooks;"));
      await route.fulfill({ response, body: source.replace("const hooks = runtime.editorHooks;",
        "window.__editorRuntime = runtime; const hooks = runtime.editorHooks;") });
    });
    try {
      await page.goto(`${url}editor.html?quality=${quality}&size=${size}&seed=1234&cache=0`);
      await page.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 240_000 });
      await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
      await page.evaluate(() => (window as any).__editorHooks.mapEditor.setEnabled(true));
      await page.getByRole("tab", { name: "Relief and water", exact: true }).click();
      await page.getByRole("button", { name: "Raise ground", exact: true }).click();
      await page.mouse.move(640, 420);
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => ({
        canvases: document.querySelectorAll("canvas#view").length,
        overlays: [...document.querySelectorAll(".map-editor-overlay")].map(canvas => canvas.className),
        brush: document.querySelectorAll(".brush-preview").length,
        terrainStats: Boolean((window as any).__terrainStats),
        history: Boolean((window as any).__mapHistory),
        editorEnabled: (window as any).__editorHooks.mapEditor.isEnabled()
      }));
      assert(before.canvases === 1, `${quality} ${size}: view canvas missing before retirement`);
      assert(before.overlays.length > 0, `${quality} ${size}: editor overlays were not created`);
      // Two owners race: the editor's own close and the runtime retirement. Both must be
      // idempotent and leave no preview/overlay behind.
      await page.evaluate(async () => {
        const runtime = (window as any).__editorRuntime;
        const editor = (window as any).__editorHooks.mapEditor;
        await Promise.all([editor.dispose(), runtime.dispose()]);
        await runtime.dispose();
      });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({
        canvases: document.querySelectorAll("canvas#view").length,
        overlays: document.querySelectorAll(".map-editor-overlay").length,
        brush: document.querySelectorAll(".brush-preview").length,
        terrainStats: Boolean((window as any).__terrainStats),
        history: Boolean((window as any).__mapHistory),
        editorEnabled: (window as any).__editorHooks?.mapEditor?.isEnabled?.() ?? false
      }));
      assert.equal(after.canvases, 0, `${quality} ${size}: view canvas survived runtime disposal`);
      assert.equal(after.overlays, 0, `${quality} ${size}: editor overlay canvases survived runtime disposal`);
      assert.equal(after.brush, 0, `${quality} ${size}: brush preview survived runtime disposal`);
      assert.equal(after.terrainStats, false, `${quality} ${size}: terrain stats survived runtime disposal`);
      assert.equal(after.history, false, `${quality} ${size}: map history stats survived runtime disposal`);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(output, `${quality}-${size}-retired.png`) });
      reports.push({ quality, size, before, after, errors,
        scope: "Standalone editor, live brush preview then whole-runtime disposal; DOM/overlay/stat cleanup, not GPU texture accounting" });
      writeFileSync(resolve(output, "report.json"), JSON.stringify(reports, null, 2));
      console.log(JSON.stringify({ quality, size, before, after }));
    } finally { await page.close(); }
  }
} finally { await browser.close(); await server.close(); }
