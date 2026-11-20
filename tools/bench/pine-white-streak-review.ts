import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { patchAtmosphereLiveCost } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "pine-white-streaks-2026-11-03");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/create-three-renderer.ts*", async route => {
      const response = await route.fetch();
      const source = patchAtmosphereLiveCost(await response.text()).replace("atmosphereDebug.api = result;",
        "atmosphereDebug.world=world;atmosphereDebug.vegetation=vegetation;atmosphereDebug.api=result;");
      await route.fulfill({ response, body: source });
    });
    await page.goto(`${url}?quality=${quality}&size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.evaluate(async () => {
      const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
      const held = live.update(0); live.update = () => held;
      const { snapshotAtmosphereFrame } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
      debug.snapshotFrame = snapshotAtmosphereFrame; debug.freeze();
      await debug.vegetation.ready;
      debug.frozenFrame.time = 42;
      debug.frozenFrame.exploration = null;
      debug.frozenFrame.workers = []; debug.frozenFrame.buildings = [];
      for (const field of ["animals", "birds", "butterflies", "critters"])
        if (debug.frozenFrame[field]) debug.frozenFrame[field].count = 0;
    });
    for (const subject of ["pine"]) {
      const report = await page.evaluate(async subject => {
        const debug = (window as any).__atmosphereLiveDebug, props = debug.world.props;
        const { rotateAroundUp } = await import(/* @vite-ignore */ String("/src/render-common/camera-state.ts"));
        const { ISO_PITCH } = await import(/* @vite-ignore */ String("/src/render-common/iso-projection.ts"));
        const types = [1, 22];
        const candidates = Array.from({ length: props.count }, (_, id) => id)
          .filter(id => types.includes(props.types[id]) && props.x[id] > 12 && props.z[id] > 12 &&
            props.x[id] < 116 && props.z[id] < 116);
        candidates.sort((a, b) => props.scale[b] - props.scale[a]);
        const id = candidates[0];
        if (id === undefined) throw new Error(`No native ${subject} prop in seed 123`);
        const yaw = .5, tilt = -.2;
        const height = props.y[id] + props.scale[id] * (.5);
        const horizontal = height / Math.tan(ISO_PITCH + tilt);
        const direction = rotateAroundUp(Math.SQRT1_2, Math.SQRT1_2, yaw);
        Object.assign(debug.frozenFrame.camera, {
          centerX: props.x[id] - direction.x * horizontal,
          centerZ: props.z[id] - direction.z * horizontal,
          zoom: 3.5, yaw, tilt
        });
        debug.draw();
        return { id, type: props.types[id], x: props.x[id], z: props.z[id], scale: props.scale[id],
          form: props.form[id], subject, ...debug.inspect() };
      }, subject);
      await page.screenshot({ path: resolve(output, `${quality}-${subject}.png`) });
      await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozenFrame.camera.zoom = 1.7;
        (window as any).__atmosphereLiveDebug.draw(); });
      await page.screenshot({ path: resolve(output, `${quality}-${subject}-gameplay.png`) });
      reports.push({ quality, ...report });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify({ reports, seed: 123,
    note: "Actual game vegetation, current sources, fixed frame. Home maps generate softwood; the oak uses canonical editor placement. Visual close review; no performance claim." }, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(`Vegetation close review: ${reports.length} native views`);
