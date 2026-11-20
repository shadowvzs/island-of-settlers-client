import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const item = "roadDecoration:indigenous-flower-pot:native";
const output = resourcesPath("project-reviews", "decoration-transform-2026-11-04", "native-b");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const proofSources = ["src/shared/settlement/road-decoration-state.ts", "src/shared/settlement/settlement-road-decorations.ts",
  "src/app/settlement/road-decoration-tool.ts", "src/app/player-inventory/mount-road-decoration.tsx",
  "src/app/player-inventory/use-road-decoration-actions.ts"];
const hashes = () => Object.fromEntries(proofSources.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const sourceBefore = hashes();
const rows: unknown[] = [], errors: string[] = [];
let active: Page | undefined, status = "failed", stage = "boot";
const state = (page: Page) => page.evaluate(item => {
  const s = (window as any).__settlement;
  return { saved: s.simulation.saveState().roadDecorations,
    count: s.playerSession.progress().inventory?.[item] ?? 0 };
}, item);
try {
  for (const quality of ["high", "minimal"] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(quality => {
      (window as any).__name = (value: unknown) => value;
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
    }, quality);
    const page = await context.newPage(); active = page;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/src/renderers/three/settlement/three-road-decorations.ts*", async route => {
      const response = await route.fetch(), source = await response.text(), anchor = "const dispose = () => {";
      assert(source.includes(anchor));
      await route.fulfill({ response, body: source.replace(anchor, `globalThis.__transformLayer = { root };\n${anchor}`) });
    });
    await page.goto(`${url}admin.html?seed=123&size=96&forest=0&mountains=0&cache=0&time=day&terrainVariation=0`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement?.playerSession),
      null, { timeout: 180000 });
    stage = `${quality}: fixture`;
    const candidates = await page.evaluate(item => {
      const s = (window as any).__settlement, sim = s.simulation;
      s.removeFog(); const progress = s.playerSession.progress(); progress.inventory ??= {}; progress.inventory[item] = 1;
      const hq = sim.buildings().find((building: any) => building.typeId === 0), points = [];
      for (let radius = 4; radius <= 12; radius++) for (let dz = -radius; dz <= radius; dz++) for (const dx of [-radius, radius]) {
        const position = { x: hq.x + dx, z: hq.z + dz };
        if (!sim.planRoadDecoration({ item, position, yaw: 0 }).ok) continue;
        const point = s.projectGround(position.x, position.z);
        if (point && point.x > 420 && point.x < 1000 && point.y > 530 && point.y < 740) points.push({ position, point });
      }
      if (points.length < 2) throw new Error("No pair of visible owned terrain candidates");
      const first = points[0]!, second = points.find(p => Math.hypot(p.position.x-first.position.x,p.position.z-first.position.z)>3);
      if (!second) throw new Error("No separated destination");
      s.selectRoadDecoration(item); return [first, second];
    }, item);
    const source = candidates[0]!, destination = candidates[1]!;
    await page.mouse.move(source.point.x + 1, source.point.y); await page.mouse.move(source.point.x, source.point.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === true);
    await page.mouse.click(source.point.x, source.point.y);
    await page.waitForFunction(() => (window as any).__settlement.simulation.roadDecorations().length === 1);
    const initial = await state(page); assert.equal(initial.count, 0);
    const open = async () => {
      const point = await page.evaluate(() => {
        const s = (window as any).__settlement, frame = s.simulation.roadDecorations()[0];
        return s.project(frame.position[0], frame.position[1] + .2, frame.position[2]);
      });
      assert(point); await page.mouse.click(point.x, point.y);
      await page.locator(".road-decoration-window:not([hidden])").getByRole("button", { name: "Rotate 90° clockwise", exact: true }).waitFor();
    };
    await page.waitForFunction(() => (window as any).__transformLayer?.root.children.some((mesh: any) => mesh.isInstancedMesh));
    await open();
    const panel = page.locator(".road-decoration-window:not([hidden])");
    assert.equal(await panel.locator(".road-decoration-panel__actions button").count(), 3);
    const buttonSizes = await panel.locator(".road-decoration-panel__actions button").evaluateAll(buttons =>
      buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height,
        label: button.getAttribute("aria-label"), text: button.textContent })));
    for (const size of buttonSizes) { assert.equal(size.width, 48); assert.equal(size.height, 48); assert(size.label); }
    stage = `${quality}: rotate`;
    const matrices = [];
    for (let turn = 1; turn <= 4; turn++) {
      const yaw = (initial.saved.placed[0].yaw + turn * Math.PI / 2) % (Math.PI * 2);
      await panel.getByRole("button", { name: "Rotate 90° clockwise", exact: true }).click();
      await page.waitForFunction(yaw => Math.abs((window as any).__settlement.simulation.roadDecorations()[0].yaw - yaw) < 1e-8, yaw);
      await page.waitForFunction(yaw => {
        const mesh = (window as any).__transformLayer.root.children.find((mesh: any) => mesh.isInstancedMesh);
        return mesh && Math.abs(mesh.instanceMatrix.array[0] - Math.cos(yaw)) < 1e-5 &&
          Math.abs(mesh.instanceMatrix.array[2] + Math.sin(yaw)) < 1e-5;
      }, yaw);
      matrices.push(await page.evaluate(() => Array.from((window as any).__transformLayer.root.children
        .find((mesh: any) => mesh.isInstancedMesh).instanceMatrix.array.slice(0, 16))));
      const current = await state(page);
      assert.equal(current.saved.placed[0].uid, initial.saved.placed[0].uid); assert.equal(current.count, 0);
      assert.deepEqual(current.saved.placed[0].position, initial.saved.placed[0].position);
      if (turn === 1) await page.screenshot({ path: resolve(output, `${quality}-rotated-panel.png`) });
    }
    assert.deepEqual(await state(page), initial);
    stage = `${quality}: move cancel`;
    await panel.getByRole("button", { name: "Move decoration", exact: true }).click();
    const blocked = await page.evaluate(() => {
      const s = (window as any).__settlement, hq = s.simulation.buildings().find((building: any) => building.typeId === 0);
      return s.projectGround(hq.x, hq.z);
    });
    assert(blocked); await page.mouse.move(blocked.x, blocked.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === false);
    await page.mouse.click(blocked.x, blocked.y);
    assert.deepEqual(await state(page), initial);
    await page.mouse.move(destination.point.x, destination.point.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === true);
    assert.deepEqual(await state(page), initial);
    await page.keyboard.press("Escape"); assert.deepEqual(await state(page), initial);
    stage = `${quality}: move commit`;
    await open(); await panel.getByRole("button", { name: "Move decoration", exact: true }).click();
    await page.mouse.move(destination.point.x, destination.point.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === true);
    await page.mouse.click(destination.point.x, destination.point.y);
    await page.waitForFunction(position => {
      const frame = (window as any).__settlement.simulation.roadDecorations()[0];
      return Math.hypot(frame.position[0] - position.x, frame.position[2] - position.z) < .1;
    }, destination.position);
    const moved = await state(page);
    assert.equal(moved.count, 0); assert.equal(moved.saved.placed.length, 1);
    assert.equal(moved.saved.placed[0].uid, initial.saved.placed[0].uid);
    assert.equal(moved.saved.placed[0].yaw, initial.saved.placed[0].yaw);
    assert.equal(moved.saved.nextUid, initial.saved.nextUid); assert.deepEqual(moved.saved.returns, initial.saved.returns);
    await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation, result = sim.loadState(sim.saveState());
      if (!result.ok) throw new Error(result.reason);
    });
    assert.deepEqual(await state(page), moved);
    await open();
    assert.equal(await panel.locator('[role="status"]').isVisible(), false);
    await page.screenshot({ path: resolve(output, `${quality}-moved-panel.png`) });
    await panel.getByRole("button", { name: "Pick up", exact: true }).click();
    await page.waitForFunction(() => (window as any).__settlement.simulation.roadDecorations().length === 0);
    assert.equal((await state(page)).count, 1);
    rows.push({ quality, buttonSizes, initial, moved, matrices, fourActualRotateClicks: true, unchangedDuringMovePreview: true,
      blockedMovePreservesOriginal: true, cancelPreservesOriginal: true, sameUidAtomicMove: true, saveLoadConserves: true, pickupReturnsExactlyOne: true });
    console.log(`${quality}: three panel icons, four rotates, renderer matrices, move cancel/commit, save and pickup passed`);
    await context.close(); active = undefined;
  }
  assert.deepEqual(errors, []); assert.deepEqual(hashes(), sourceBefore); status = "passed";
} finally {
  if (active && !active.isClosed()) {
    await active.screenshot({ path: resolve(output, "failure.png") }).catch(() => undefined);
    writeFileSync(resolve(output, "failure.txt"), await active.locator("body").innerText().catch(() => "unavailable"));
  }
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, stage, rows, errors, sourceBefore, sourceAfter: hashes() }, null, 2));
}
