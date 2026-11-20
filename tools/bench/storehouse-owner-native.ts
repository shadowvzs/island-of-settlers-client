import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "storehouse-traffic-2026-11-04", process.argv[2] ?? "native-b");
mkdirSync(output, { recursive: true });
const savePath = "/home/shadowvzs/Downloads/island-settlers-2026-11-03 (2).json";
const bytes = readFileSync(savePath), save = JSON.parse(bytes.toString());
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const sourceHash = hash(bytes), errors: string[] = [], samples: unknown[] = [];
const { server, url } = await startDevServer(), browser = await launchBrowser();
let status = "failed";
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;window.__storageNativeModels=[];");
  // Hold only the browser wall clock at the input snapshot so startup has no offline gap to process.
  await page.addInitScript(savedAt => { Date.now = () => savedAt; }, save.savedAt);
  await page.addInitScript(() => {
    localStorage.setItem("island-of-settlers.graphics.detail", "high");
    localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
  });
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch(), body = await response.text();
    assert(body.includes("window.__islandReady = true"));
    await route.fulfill({ response, body: body.replace("window.__islandReady = true",
      "window.__storageWorldReview={world,camera,renderer,environment};window.__islandReady = true") });
  });
  await page.route("**/src/renderers/three/buildings/roman-building.ts*", async route => {
    const response = await route.fetch(), body = await response.text();
    const marker = /root\.userData\.upAxis\s*=\s*\[\s*0\s*,\s*1\s*,\s*0\s*\]\s*;?/;
    if (!marker.test(body)) {
      errors.push("Storehouse model instrumentation marker absent in served module");
      writeFileSync(resolve(output, "served-building-module.txt"), body);
      await route.fulfill({ response, body }); return;
    }
    await route.fulfill({ response, body: body.replace(marker, match => match +
      "\nif(definition.id===29)window.__storageNativeModels.push({root,recipe});") });
  });
  await page.route("**/storage-owner-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}storage-owner-fixture.html`);
  await page.evaluate(async value => {
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(value));
  }, save);
  await page.goto(`${url}admin.html?quality=high&cache=0&reveal=1&time=day`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement?.simulation),
    null, { timeout: 120000 });
  assert.deepEqual(errors, []);
  await page.evaluate(async () => {
    const sim = (window as any).__settlement.simulation, view = (window as any).__storageWorldReview;
    const building = sim.buildings().find((entry: any) => entry.uid === 7);
    if (building?.typeId !== 29 || sim.playerNation() !== "chinese") throw new Error("Owner storehouse missing");
    const originalBlocked = sim.snapshot().actors.find((actor: any) => actor.uid === 398);
    if (originalBlocked?.ware !== "planks" || originalBlocked.delivery?.source !== 7 ||
      originalBlocked.delivery?.destination !== 12) throw new Error("Original loaded job was altered before the native trace");
    (window as any).__storageStep = sim.update.bind(sim);
    sim.update = () => undefined;
    view.environment.setDayMode("sun");
    Object.assign(view.camera, { centerX: building.x, centerZ: building.z, zoom: 4, yaw: .65, tilt: -.7 });
    const { panByScreen } = await import(/* @vite-ignore */ String("/src/render-common/camera-controller.ts"));
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    for (let i = 0; i < 4; i++) await frame();
    for (let attempt = 0; attempt < 3; attempt++) {
      const centre = view.renderer.projectToViewport(building.doorThreshold.x, building.y + .8, building.doorThreshold.z);
      panByScreen(view.camera, centre.x - innerWidth / 2, centre.y - innerHeight * .45);
      for (let i = 0; i < 4; i++) await frame();
    }
  });
  let previous = 0;
  for (const seconds of [0, 2, 5, 10, 20, 30]) {
    const row = await page.evaluate(async ticks => {
      const sim = (window as any).__settlement.simulation;
      for (let tick = 0; tick < ticks; tick++) (window as any).__storageStep(.05);
      for (let i = 0; i < 3; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const building = sim.buildings().find((entry: any) => entry.uid === 7);
      const { storageDoorLeafOpenings } = await import(/* @vite-ignore */ String("/src/shared/settlement/settlement-door-activity.ts"));
      const leaves = [...storageDoorLeafOpenings(building) ?? [building.door, building.door]];
      const entry = (window as any).__storageNativeModels.find((model: any) => !model.root.userData.disposed &&
        Math.abs(model.root.position.x - building.x) < .001 && Math.abs(model.root.position.z - building.z) < .001);
      if (!entry) throw new Error("Actual world storehouse model not bound");
      const left = entry.root.getObjectByName("door_left"), right = entry.root.getObjectByName("door_right");
      const rotations = [left?.rotation.y, right?.rotation.y];
      return { tick: sim.tickCount(), leaves, rotations, queue: sim.doorQueueSnapshot(7),
        actors: sim.snapshot().actors.filter((actor: any) => actor.visible &&
          Math.hypot(actor.x - building.x, actor.z - building.z) < 5).map((actor: any) => ({
          uid: actor.uid, phase: actor.phase, x: actor.x, z: actor.z, ware: actor.ware })),
        stats: (window as any).__storageWorldReview.renderer.getStats() };
    }, Math.round((seconds - previous) * 20));
    previous = seconds;
    for (let side = 0; side < 2; side++) {
      const expected = row.leaves[side]! * Math.PI / 2 * (side === 0 ? -1 : 1);
      assert(Math.abs(row.rotations[side]! - expected) < .001, "Actual renderer must use independent actor-derived leaves");
    }
    samples.push({ seconds, ...row });
    await page.screenshot({ path: resolve(output, `storehouse-${seconds}s.png`) });
  }
  assert.equal(hash(readFileSync(savePath)), sourceHash);
  assert.deepEqual(errors, []);
  status = "passed";
} finally {
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, savePath, sourceHash, errors, samples,
    scope: "Actual owner world/rendered model with normal live fixed ticks stepped explicitly. Browser wall clock held at source savedAt to prevent startup offline replay; daylight and camera overridden for review only. Original input unchanged. High only." }, null, 2));
}
