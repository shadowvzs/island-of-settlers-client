import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { createServer } from "vite";

import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser } from "./browser";
import { resourcesPath } from "./resources-path";

const reviewRoot = resourcesPath("project-reviews", "ground-materials-2026-11-02");
const output = resolve(reviewRoot, "native");
mkdirSync(output, { recursive: true });
const sourceMap = (folder: string) => {
  const manifest = JSON.parse(readFileSync(resolve(reviewRoot, folder, "source-manifest.json"), "utf8"));
  return new Map<string, string>(manifest.map((row: any) => [resolve(row.path),
    readFileSync(resolve(reviewRoot, folder, "source", basename(row.path)), "utf8")]));
};
const originalSources = sourceMap("baseline"), candidateSources = sourceMap("candidate");
const fixedVegetation = sourceMap("fixed-vegetation");
const rows: any[] = [];
const fixturePath = resolve(output, "fixture.json");
let fixture: any = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : null;
for (const variant of ["before-a", "after", "before-b"]) {
  const original = variant !== "after", overrides = new Set<string>();
  const server = await createServer({ cacheDir: mkdtempSync(resolve(tmpdir(), "ground-material-review-vite-")),
    logLevel: "error", plugins: [{ name: "ground-painter-review-source", enforce: "pre",
      load: id => {
        const clean = id.split("?")[0]!;
        const materialSources = original ? originalSources : candidateSources;
        const saved = fixedVegetation.get(clean) ?? materialSources.get(clean);
        if (saved) overrides.add(basename(clean));
        return saved;
      } }], server: { host: "127.0.0.1", port: 5199 } });
  await server.listen();
  const url = server.resolvedUrls!.local[0]!, browser = await launchBrowser();
  try {
    for (const quality of ["high", "minimal"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.routeWebSocket("**/*", () => {});
      await page.addInitScript("window.__name=value=>value;");
      await page.route("**/create-three-renderer.ts*", async route => {
        const response = await route.fetch();
        const source = patchAtmosphereLiveCost(await response.text()).replace("atmosphereDebug.camera = camera;", `
          atmosphereDebug.camera = camera;
          if(atmosphereDebug.frozen){uniformValues.uWindPhase.fill(0);uniformValues.uCloudDrift.fill(0);}
        `).replace("atmosphereDebug.api = result;",
          "atmosphereDebug.world=world;atmosphereDebug.vegetation=vegetation;atmosphereDebug.api=result;");
        await route.fulfill({ response, body: source });
      });
      await page.route("**/exploration-weather-adapter.ts*", async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: patchAtmosphereWeatherClock(await response.text()) });
      });
      await page.goto(`${url}?quality=${quality}&size=128&seed=1234&mountains=2&cache=0&skipLogin=1&time=day&reveal=1`);
      await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
      await page.locator("#loading-screen").waitFor({ state: "detached" });
      const setup = await page.evaluate(async incoming => {
        const debug = (window as any).__atmosphereLiveDebug, live = (window as any).__settlement;
        const held = live.update(0); live.update = () => held;
        const { snapshotAtmosphereFrame } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-frame-snapshot.ts"));
        debug.snapshotFrame = snapshotAtmosphereFrame; debug.freeze();
        debug.renderer.info.autoReset = false;
        await debug.vegetation.ready;
        const { world } = debug, stride = world.cellsX + 1;
        let chosen = incoming;
        if (!chosen) {
          const centres = ["meadow", "stony-shore"].map(kind => {
            let best = { score: -Infinity, x: 64, z: 64 };
            for (let z = 16; z < world.cellsZ - 16; z += 4) for (let x = 16; x < world.cellsX - 16; x += 4) {
              if (world.heights[z * stride + x] < world.seaLevel + .2) continue;
              const sums = new Array(9).fill(0);
              let land = 0;
              for (let dz = -6; dz <= 6; dz += 2) for (let dx = -6; dx <= 6; dx += 2) {
                const vertex = (z + dz) * stride + x + dx;
                if (world.heights[vertex] <= world.seaLevel + .1) continue;
                land++;
                for (let material = 0; material < 9; material++) sums[material] += world.splat[vertex * 9 + material];
              }
              const grass = sums[0] + sums[1] + sums[2], stone = sums[4] + sums[5] + sums[7];
              const mixed = sums.filter(sum => sum > 200).length;
              const score = (kind === "meadow" ? grass + sums[3] * 1.8 : stone * 1.5 - grass * .25) + mixed * 400 + land * 50;
              if (score > best.score) best = { score, x, z };
            }
            return { kind, ...best };
          });
          chosen = { centres, environment: structuredClone(debug.frozenFrame.environment), time: 42 };
        }
        debug.frozenFrame.time = chosen.time;
        debug.frozenFrame.environment = structuredClone(chosen.environment);
        debug.frozenFrame.exploration = null;
        for (const field of ["workers", "buildings", "shipPreviewWorkers", "ships", "shipSites", "shuttleBoats",
          "marbleDeposits", "adventureCamps", "militaryArrows", "militaryDeaths", "transportHorses", "handcarts",
          "territoryBorders", "fields", "mounts", "cavalryMounts", "cavalryRiders"])
          debug.frozenFrame[field] = [];
        for (const field of ["rallyBanner", "placementGhost", "placementPreviews", "roadPreview"])
          debug.frozenFrame[field] = null;
        const standing = debug.frozenFrame.felling.getState(-1);
        debug.frozenFrame.felling = { ...debug.frozenFrame.felling,
          felledIds: () => [][Symbol.iterator](), getState: () => standing };
        debug.frozenFrame.growth = { growing: () => [][Symbol.iterator](), grownIds: () => [][Symbol.iterator](),
          isGrown: () => false, isGrowing: () => false, revision: () => 0 };
        for (const field of ["animals", "birds", "butterflies", "critters"])
          if (debug.frozenFrame[field]) debug.frozenFrame[field].count = 0;
        debug.frozenFrame.critters.ripples.count = 0;
        debug.frozenFrame.felling.leaves.alpha.fill(0);
        if (debug.frozenFrame.critters?.ripples) debug.frozenFrame.critters.ripples.count = 0;
        await debug.api.prepareFrame(debug.frozenFrame);
        const gl = debug.renderer.getContext(), extension = gl.getExtension("WEBGL_debug_renderer_info");
        let worldHash = 2166136261;
        const props = world.props;
        for (const values of [world.heights, world.splat, props.types, props.form, props.x, props.y, props.z, props.scale]) {
          const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
          for (const value of bytes) worldHash = Math.imul(worldHash ^ value, 16777619);
        }
        return { fixture: chosen, gpu: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
          propCount: props.count, worldHash: worldHash >>> 0 };
      }, fixture);
      if (!fixture) { fixture = setup.fixture; writeFileSync(fixturePath, JSON.stringify(fixture, null, 2)); }
      for (const centre of fixture.centres) for (const [view, zoom] of [["normal", 1], ["close", 2.8]] as const) {
        const result = await page.evaluate(async ({ centre, zoom }) => {
          const debug = (window as any).__atmosphereLiveDebug;
          Object.assign(debug.frozenFrame.camera, { centerX: centre.x, centerZ: centre.z, zoom, yaw: 0, tilt: -.2 });
          await debug.api.prepareFrame(debug.frozenFrame);
          debug.frozenFrame.camera.zoom = .4;
          for (let warm = 0; warm < 32; warm++) debug.draw();
          debug.frozenFrame.camera.zoom = 3.5;
          debug.draw();
          debug.frozenFrame.camera.zoom = zoom;
          debug.draw();
          const { measureAtmosphereGpu } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-gpu.ts"));
          const timing = await measureAtmosphereGpu(debug.renderer, debug.draw, 24);
          return { ...debug.inspect(), timing };
        }, { centre, zoom });
        await page.screenshot({ path: resolve(output, `${variant}-${quality}-${centre.kind}-${view}.png`) });
        if (view === "close") {
          await page.evaluate(() => {
            const debug = (window as any).__atmosphereLiveDebug, nativeRender = debug.renderer.render;
            // Diagnostic still only: expose the native ground beneath its unchanged vegetation.
            debug.renderer.render = function(scene: any, camera: any) {
              const restore = debug.vegetation.hideForRefraction();
              try { return nativeRender.call(this, scene, camera); }
              finally { restore(); }
            };
            try { debug.draw(); }
            finally { debug.renderer.render = nativeRender; }
          });
          await page.screenshot({ path: resolve(output, `${variant}-${quality}-${centre.kind}-ground-only.png`) });
        }
        rows.push({ ...result, gpu: setup.gpu, propCount: setup.propCount, quality, variant, view,
          ground: centre.kind, worldHash: setup.worldHash });
        writeFileSync(resolve(output, "review.json"), JSON.stringify({ errors, fixture, sourceOverrides: [...overrides], rows }, null, 2));
      }
      assert.deepEqual(errors, []);
      for (const file of ["recipes-meadow.ts", "recipes-soil.ts", "recipes-rock.ts", "grass-blades.ts"])
        assert(overrides.has(file), `Pinned material painter override was not loaded: ${file}`);
      assert(overrides.has("worker-pool.ts") && overrides.has("foliage-strokes.ts"), "Vegetation was not pinned");
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
}
const budgetFailures: unknown[] = [];
for (const row of rows.filter(row => row.variant === "after")) {
  const before = rows.filter(sample => sample.variant !== "after" && sample.quality === row.quality &&
    sample.view === row.view && sample.ground === row.ground);
  const passed = before.every(sample => sample.draws === row.draws && sample.triangles === row.triangles &&
    sample.worldHash === row.worldHash && sample.resources.textures === row.resources.textures &&
    sample.resources.geometries === row.resources.geometries);
  if (!passed) budgetFailures.push({ quality: row.quality, ground: row.ground, view: row.view,
    after: { draws: row.draws, triangles: row.triangles, resources: row.resources },
    before: before.map(sample => ({ variant: sample.variant, draws: sample.draws,
      triangles: sample.triangles, resources: sample.resources })) });
}
const receipt = JSON.parse(readFileSync(resolve(output, "review.json"), "utf8"));
writeFileSync(resolve(output, "review.json"), JSON.stringify({ ...receipt,
  budgetValidation: { passed: budgetFailures.length === 0, failures: budgetFailures } }, null, 2));
assert.deepEqual(budgetFailures, [], "Native budget comparison requires identical frozen-scene counters");
console.log(`Ground native review: ${rows.length} fixed-vegetation A/B/A views and GPU timings`);
