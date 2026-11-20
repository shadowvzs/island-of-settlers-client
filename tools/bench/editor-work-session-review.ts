import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentAction } from "./development-ui-helpers";

const output = resolve("../resources/project-reviews/editor-work-session-2026-10-20");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["minimal", "high"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/src/app/main.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      assert(source.includes("window.__islandReady = true"));
      await route.fulfill({ response, body: source.replace("window.__islandReady = true",
        "window.__editorSessionReview={world,camera,renderer};window.__islandReady = true") });
    });
    try {
      await page.goto(`${url}?quality=${quality}&size=512&seed=1234&landform=island&forest=2&mountains=2&cache=0&reveal=1`);
      await page.waitForFunction(() => (window as any).__islandReady ||
        document.querySelector("#loading-screen.is-failed"), null, { timeout: 180000 });
      assert(await page.evaluate(() => Boolean((window as any).__islandReady)), "Dense512 native boot failed");
      await page.locator("#loading-screen").waitFor({ state: "detached" });
      console.log(JSON.stringify({ quality, stage: "dense512-ready" }));
      await (await openDevelopmentAction(page, "Map editor")).click();
      await page.getByRole("tab", { name: "Relief and water", exact: true }).click();
      const target = await page.evaluate(async () => {
        const world = (window as any).__editorSessionReview.world;
        const { extractTerrainComponent } = await import(/* @vite-ignore */ String(
          "/src/shared/world/editing/terrain/terrain-component.ts"));
        const { seedRestoreProtectedVertices } = await import(/* @vite-ignore */ String(
          "/src/shared/world/editing/terrain/seed-restore-protection.ts"));
        const { createTerrainEditState } = await import(/* @vite-ignore */ String(
          "/src/shared/world/editing/terrain/terrain-edit-state.ts"));
        for (let z = 12; z < 500; z += 4) for (let x = 12; x < 500; x += 4) {
          const vertex = z * 513 + x, height = world.heights[vertex];
          if (height < 4 || world.props.x.some((px: number, id: number) =>
            world.props.types[id] !== 255 && Math.hypot(px - x, world.props.z[id] - z) < 6)) continue;
          const blocked = seedRestoreProtectedVertices(world, createTerrainEditState(),
            { minX: x - 4, minZ: z - 4, maxX: x + 4, maxZ: z + 4 });
          let free = true;
          for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++)
            if (blocked.has((z + dz) * 513 + x + dx)) free = false;
          if (!free) continue;
          const threshold = Math.max(.1, Math.floor((height - 1) * 10) / 10);
          const component = extractTerrainComponent(world, { x, z }, "relief", threshold);
          if (!component || component.truncated) continue;
          const cells = new Set(component.cells);
          for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++)
            if (!cells.has((z + dz) * 512 + x + dx)) free = false;
          if (free) return { x, z, threshold, contourCells: cells.size, height };
        }
        throw new Error("No natural unprotected dry contour interior fits the brush/restore proof");
      });
      const digest = () => page.evaluate(async () => {
        const world = (window as any).__editorSessionReview.world;
        const hash = async (array: ArrayBufferView) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
          new Uint8Array(array.buffer, array.byteOffset, array.byteLength) as Uint8Array<ArrayBuffer>))]
          .map(value => value.toString(16).padStart(2, "0")).join("");
        return { heights: await hash(world.heights), paint: await hash(world.splat) };
      });
      const waitGround = () => page.waitForFunction(() => !(window as any).__terrainStats.busy,
        null, { timeout: 120000 });
      const focus = async (point: { x: number; z: number }) => {
        await page.evaluate(point => (window as any).__settlement.focusGround(point.x, point.z, 2), point);
        await page.waitForTimeout(150);
      };
      const baseline = await digest();
      await focus(target);
      for (const name of ["Brush size", "Brush strength"]) {
        await page.getByRole("slider", { name: new RegExp(`^${name}:`) }).focus();
        await page.keyboard.press("Home");
      }
      await page.getByRole("button", { name: "Raise ground", exact: true }).click();
      const point = await page.evaluate(target => (window as any).__settlement.projectGround(target.x, target.z), target);
      const started = Date.now();
      await page.mouse.click(point.x, point.y);
      await page.waitForFunction(previous => (window as any).__terrainStats.edits > previous, await page.evaluate(
        () => Math.max(0, (window as any).__terrainStats.edits - 1)), { timeout: 15000 });
      await waitGround();
      const brushMs = Date.now() - started, brushed = await digest();
      assert.notEqual(brushed.heights, baseline.heights, "Actual brush must alter native ground");
      await page.getByRole("button", { name: "Raise ground", exact: true }).click();
      await page.getByRole("combobox", { name: "Generated terrain contour", exact: true }).selectOption("relief");
      await page.getByRole("spinbutton", { name: "Relief contour above sea", exact: true }).fill(String(target.threshold));
      await page.getByRole("button", { name: "Select generated contour at view centre", exact: true }).click();
      const restore = page.getByRole("button", { name: "Regenerate selected contour interior from saved seed recipe", exact: true });
      await page.waitForTimeout(200);
      await restore.click();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some(element =>
        /Restored [1-9]\d* terrain points inside the contour/.test(element.textContent ?? "")), null, { timeout: 120000 });
      await waitGround();
      assert.deepEqual(await digest(), baseline, "Exact seed restore must recover the complete pre-brush ground/paint");
      await page.getByRole("button", { name: "Undo (Ctrl+Z)", exact: true }).click(); await waitGround();
      assert.deepEqual(await digest(), brushed);
      await page.getByRole("button", { name: "Redo (Ctrl+Y / Ctrl+Shift+Z)", exact: true }).click(); await waitGround();
      assert.deepEqual(await digest(), baseline);
      await page.screenshot({ path: resolve(output, `${quality}-exact-seed-restored.png`) });
      await page.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
      const home = await page.evaluate(() => ({ ...(window as any).__settlement.simulation.home() }));
      await focus(home);
      await page.getByRole("button", { name: "Place HQ", exact: true }).click();
      const hqPoint = await page.evaluate(home => (window as any).__settlement.projectGround(home.x, home.z), home);
      await page.mouse.click(hqPoint.x, hqPoint.y);
      const inspect = page.getByRole("button", { name: "Inspect island connectivity and economy space", exact: true });
      const section = inspect.locator("xpath=ancestor::*[@data-startup-spatial][1]");
      const status = section.getByRole("status");
      const inspectionStarted = Date.now(); await inspect.click();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-startup-spatial]')].some(element =>
        element.getAttribute("aria-busy") === "false" &&
        ["witness", "unknown"].includes(element.getAttribute("data-startup-spatial") ?? "")),
        null, { timeout: 45000 });
      const inspection = await status.innerText();
      const inspectionMs = Date.now() - inspectionStarted;
      const startupSpatial = await section.getAttribute("data-startup-spatial");
      const authoredValidation = await section.getAttribute("data-authored-validation");
      const findings = await section.locator("li").allTextContents();
      console.log(JSON.stringify({ quality, stage: "inspection-complete", startupSpatial, authoredValidation }));
      await page.screenshot({ path: resolve(output, `${quality}-completed-bounded-inspection.png`) });
      assert.deepEqual(errors, []);
      reports.push({ quality, target, brushMs, inspectionMs, inspection, startupSpatial, authoredValidation, findings, errors,
        scope: "Natural dense512 brush and exact saved-seed restore through UI, history, completed bounded static report; UNKNOWN is not a full economy/navigation proof" });
      writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
    } catch (error) {
      reports.push({ quality, outcome: "failed", errors, error: error instanceof Error ? error.stack : String(error) });
      writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
      await page.screenshot({ path: resolve(output, `${quality}-failure.png`), timeout: 10000 }).catch(() => {});
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); await server.close(); }
