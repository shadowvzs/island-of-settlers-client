import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { createServer } from "vite";

import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser } from "./browser";
import { resourcesPath } from "./resources-path";

const reviewRoot = resourcesPath("project-reviews", "vegetation-realism-2026-11-02");
const output = resolve(reviewRoot, "native-dense");
mkdirSync(output, { recursive: true });
const sourceFiles = [
  "src/render-common/props/tree-parts.ts", "src/render-common/trees/island-tree-mesh.ts",
  "src/render-common/props/plants/shrub-graph.ts", "src/render-common/props/plants/forest-plants.ts",
  "src/render-common/props/plants/riverbank-plants.ts", "src/render-common/props/plants/field-grasses.ts",
  "src/render-common/props/plants/plant-parts.ts", "src/render-common/trees/foliage-strokes.ts",
  "src/render-common/props/adventure-prop-kinds.ts", "src/app/worker-pool.ts",
  "src/renderers/three/three-vegetation.ts"
];
const originalSources = new Map(sourceFiles.map(file => [resolve(file), readFileSync(
  resolve(reviewRoot, "baseline/source", basename(file)), "utf8")]));
const rows: any[] = [];
const fixturePath = resolve(output, "native-fixture.json");
let fixture: any = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;
for (const variant of ["before-a", "after", "before-b"]) {
  const original = variant !== "after";
  const restoredSources = new Set<string>();
  const server = await createServer({ cacheDir: mkdtempSync(resolve(tmpdir(), "vegetation-realism-vite-")),
    logLevel: "error", plugins: [{ name: "vegetation-original-review", enforce: "pre",
      load: id => {
        const clean = id.split("?")[0]!;
        const saved = original ? originalSources.get(clean) : undefined;
        if (saved) restoredSources.add(basename(id.split("?")[0]!));
        return saved;
      } }],
    server: { host: "127.0.0.1", port: 5199 } });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!;
  const browser = await launchBrowser();
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
      await page.route("**/exploration-weather-adapter.ts*", async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: patchAtmosphereWeatherClock(await response.text()) });
      });
      await page.goto(`${url}?quality=${quality}&size=128&seed=123&cache=0&skipLogin=1&time=day&reveal=1`);
      await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
      await page.locator("#loading-screen").waitFor({ state: "detached" });
      const setup = await page.evaluate(async incoming => {
        const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
        const held = live.update(0); live.update = () => held;
        const { snapshotAtmosphereFrame } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
        debug.snapshotFrame = snapshotAtmosphereFrame; debug.freeze();
        debug.renderer.info.autoReset = false;
        await debug.vegetation.ready;
        const { world } = debug, props = world.props;
        let chosen = incoming;
        if (!chosen) {
          let best = { count: -1, x: 64, z: 64 };
          for (let z = 16; z < world.cellsZ - 16; z += 8) for (let x = 16; x < world.cellsX - 16; x += 8) {
            let count = 0;
            for (let index = 0; index < props.count; index++)
              if ([0, 1, 2, 18, 21, 22, 23, 24].includes(props.types[index]) &&
                Math.hypot(props.x[index] - x, props.z[index] - z) < 12) count++;
            if (count > best.count) best = { count, x, z };
          }
          chosen = { densityNote: "Densest native tree patch with dense field cover; not maximum-density forest",
            centre: best, environment: structuredClone(debug.frozenFrame.environment), time: 42 };
        }
        debug.frozenFrame.time = chosen.time;
        debug.frozenFrame.environment = structuredClone(chosen.environment);
        debug.frozenFrame.exploration = null;
        debug.frozenFrame.workers = []; debug.frozenFrame.buildings = [];
        for (const field of ["animals", "birds", "butterflies", "critters"])
          if (debug.frozenFrame[field]) debug.frozenFrame[field].count = 0;
        const gl = debug.renderer.getContext(), extension = gl.getExtension("WEBGL_debug_renderer_info");
        let worldHash = 2166136261;
        for (const values of [props.types, props.form, props.x, props.y, props.z, props.scale]) {
          const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
          for (const value of bytes) worldHash = Math.imul(worldHash ^ value, 16777619);
        }
        return { fixture: chosen, gpu: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
          propCount: props.count, worldHash: worldHash >>> 0 };
      }, fixture);
      if (!fixture) {
        fixture = setup.fixture; writeFileSync(fixturePath, JSON.stringify(fixture, null, 2));
      }
      for (const [view, zoom] of [["normal", 1], ["close", 2.8]] as const) {
        const result = await page.evaluate(async ({ centre, zoom }) => {
          const debug = (window as any).__atmosphereLiveDebug;
          Object.assign(debug.frozenFrame.camera, { centerX: centre.x, centerZ: centre.z, zoom, yaw: 0, tilt: -.2 });
          debug.draw();
          const { measureAtmosphereGpu } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-gpu.ts"));
          const timing = await measureAtmosphereGpu(debug.renderer, debug.draw, 24);
          return { ...debug.inspect(), timing };
        }, { centre: fixture.centre, zoom });
        await page.screenshot({ path: resolve(output, `${variant}-${quality}-${view}.png`) });
        rows.push({ ...result, gpu: setup.gpu, propCount: setup.propCount, quality, variant, view, worldHash: setup.worldHash });
        writeFileSync(resolve(output, "native-review.json"), JSON.stringify({ errors, fixture, originalSourceOverrides: [...restoredSources], rows }, null, 2));
      }
      assert.deepEqual(errors, []);
      if (original) for (const file of ["tree-parts.ts", "foliage-strokes.ts", "field-grasses.ts", "forest-plants.ts"])
        assert(restoredSources.has(file), `Original source override was not used: ${file}`);
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
}
for (const row of rows.filter(row => row.variant === "after")) {
  const before = rows.filter(sample => sample.variant !== "after" && sample.quality === row.quality &&
    sample.view === row.view);
  assert(before.every(sample => sample.draws === row.draws && sample.triangles === row.triangles && sample.worldHash === row.worldHash),
    `Native geometry/draw budget changed for ${row.quality}/${row.view}`);
}
console.log(`Vegetation native review: ${rows.length} same-seed view/timing receipts`);
