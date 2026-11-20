import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ROAD_DECORATION_ITEM_DEFINITIONS } from "../../../island-of-settlers-shared/src/road-decoration-items";
import { PLANT_COMPLETION_ITEM_IDS, plantCompletionModelFamily } from "../../../island-of-settlers-shared/src/road-plant-completion";
import { launchBrowser, startDevServer } from "./browser";

const run = process.argv[2] ?? "live-a";
assert(/^[a-z0-9-]+$/.test(run));
const output = resolve("../resources/project-reviews/verification-completion-2026-11-05/decorations", run);
assert(!existsSync(resolve(output, "report.json")), "Preserve completed evidence");
mkdirSync(output, { recursive: true });
const representatives = [...new Map(PLANT_COMPLETION_ITEM_IDS.filter(id =>
  !ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!.potted).map(id =>
  [plantCompletionModelFamily(ROAD_DECORATION_ITEM_DEFINITIONS[id]!.plant!), id])).values()];
const { server, url } = await startDevServer({ unlockAll: false });
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const errors: string[] = [], rows: unknown[] = [];
let passed = false;
try {
  browser = await launchBrowser();
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { height: 850, width: 1200 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(quality => {
      (window as any).__name = (value: unknown) => value;
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
      localStorage.setItem("island-of-settlers.sound", "0");
    }, quality);
    await page.route("**/src/app/island-runtime.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = "window.__islandReady = true;";
      if (!source.includes(anchor)) {
        errors.push("Missing live-runtime observation anchor");
        await route.fulfill({ response }); return;
      }
      await route.fulfill({ response, body: source.replace(anchor,
        `{ globalThis.__decorationLive = { camera, renderer, world }; ${anchor} }`) });
    });
    await page.route("**/src/renderers/three/settlement/three-road-decorations.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = "const dispose = () => {";
      if (!source.includes(anchor)) {
        errors.push("Missing decoration observation anchor");
        await route.fulfill({ response }); return;
      }
      await route.fulfill({ response, body: source.replace(anchor,
        `globalThis.__decorationLayer = { root, ready: () => templates.ready(), statistics: () => templates.statistics() };\n${anchor}`) });
    });
    await page.goto(`${url}admin.html?seed=123&size=96&forest=0.4&mountains=0.15&cache=0&time=day&terrainVariation=0.25`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__decorationLive),
      null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    await page.evaluate(() => {
      const s = (window as any).__settlement;
      s.removeFog();
      const hq = s.simulation.headquarters, { camera } = (window as any).__decorationLive;
      Object.assign(camera, { centerX: hq.x, centerZ: hq.z, zoom: .9 });
    });
    const sample = () => page.evaluate(async () => {
      for (let index = 0; index < 120; index++) await new Promise(requestAnimationFrame);
      const intervals: number[] = [];
      let previous = await new Promise<number>(requestAnimationFrame);
      for (let index = 0; index < 300; index++) {
        const now = await new Promise<number>(requestAnimationFrame);
        intervals.push(now - previous); previous = now;
      }
      intervals.sort((a, b) => a - b);
      const { renderer } = (window as any).__decorationLive, gl = renderer.gl;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      return { frames: intervals.length, meanMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
        p50Ms: intervals[150], p95Ms: intervals[285], maxMs: intervals.at(-1),
        gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        stats: renderer.getStats(), resources: renderer.getResourceStats?.() };
    });
    const baseline = await sample();
    const placed = await page.evaluate(async items => {
      const s = (window as any).__settlement, sim = s.simulation, hq = sim.headquarters;
      if (!s.playerSession.grantGems(1000)) throw new Error("Guest performance fixture cannot seed gems");
      const placements: unknown[] = [], refused: unknown[] = [];
      for (const { item, offerId } of items) {
        const purchased = await s.playerSession.buyGemOffer(offerId);
        if (purchased !== true) throw new Error(`Guest canonical decoration purchase refused: ${purchased}`);
        let done = false;
        for (let radius = 4; radius <= 30 && !done; radius++) {
          for (let dz = -radius; dz <= radius && !done; dz++) for (const dx of [-radius, radius]) {
            const position = { x: hq.x + dx, z: hq.z + dz };
            const request = { item, position, yaw: .3 };
            if (!sim.planRoadDecoration(request).ok) continue;
            const result = sim.placeRoadDecoration(request);
            if (!result.ok) throw new Error(`Planned live decoration rejected: ${JSON.stringify(result)}`);
            placements.push({ item, position }); done = true; break;
          }
        }
        if (!done) refused.push(item);
      }
      return { placements, refused, count: sim.roadDecorations().length,
        actors: sim.frames().length, buildings: sim.buildings().length,
        worldProps: (window as any).__decorationLive.world.props.count };
    }, representatives.map(item => ({ item, offerId: ROAD_DECORATION_ITEM_DEFINITIONS[item]!.offerId })));
    await page.waitForFunction(() => (window as any).__decorationLayer.root.children
      .some((mesh: any) => mesh.isInstancedMesh && mesh.count > 0), null, { timeout: 60000 });
    await page.evaluate(() => (window as any).__decorationLayer.ready());
    const after = await sample();
    const residency = await page.evaluate(() => ({ ...(window as any).__decorationLayer.statistics(),
      rendered: (window as any).__decorationLayer.root.children.filter((mesh: any) => mesh.isInstancedMesh && mesh.count > 0)
        .map((mesh: any) => ({ name: mesh.name, count: mesh.count })) }));
    await page.screenshot({ path: resolve(output, `${quality}-live-mixed.png`) });
    rows.push({ quality, baseline, after, placed, residency });
    assert(placed.count > 0 && !residency.errors && !residency.pending);
    await page.close();
  }
  assert.deepEqual(errors, []); passed = true;
} finally {
  try { await browser?.close(); } finally { await server.close(); }
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ passed, rows, errors,
    scope: "Actual generated96x96 terrain, natural foliage, HQ/workers and production decoration layer; " +
      "Guest fixture gems buy actual items through canonical player-session offers, then actual live placement commands. " +
      "300 warm-frame intervals/profile before/after. " +
      "Machine/GPU identity is recorded; not a large-town/fleet or sustained phone/thermal benchmark. " +
      "Guest fixture currency is not an authenticated world purchase/placement witness." }, null, 2));
}
