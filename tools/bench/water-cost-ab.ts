import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import type { QualityLevel } from "../../src/render-common/quality";
import { launchBrowser, startDevServer } from "./browser";
import {
  enterPossessed,
  openReviewPage,
  pinLight,
  prepareScene,
  sailShip,
  setIsoView,
  setPossessedView,
  stageReviewSave
} from "./water-review-page";

/**
 * R18a cost A/B inside one page, on one frozen frame: the water and terrain programs alternate
 * between the base worktree's shader sources and this lane's (ABBA order), and the wake layer
 * alternates hidden/shown. R18b adds "reflection" (the water reflection pass off/on through `__ssr`)
 * and "control" (an A/A run that changes nothing: the method's noise floor). FISH-SCHOOLS adds "fish"
 * (the fish and fish-shadow draws of the refraction capture hidden/shown). Each variant draws the
 * whole frame under a GPU timer query, so shared-GPU noise from other lanes hits both variants alike.
 * The result is the median per-frame difference.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [BASE_CLIENT=<base worktree client dir>, for shaders and wake]
 *   [QUALITIES=high,minimal] [PAIRS=40] [MODES=shaders,wake] (any of shaders, wake, reflection, control, fish)
 */
type CostMode = "control" | "fish" | "reflection" | "shaders" | "wake";
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
const baseClient = process.env.BASE_CLIENT;
const modes = (process.env.MODES ?? "shaders,wake").split(",") as CostMode[];
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
assert(baseClient || !modes.some(mode => mode === "shaders" || mode === "wake"),
  "The shaders and wake modes need BASE_CLIENT (their materials are found against the base sources)");
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",") as QualityLevel[];
const pairs = Number(process.env.PAIRS ?? 40);
const saveText = readFileSync(sourcePath, "utf8");
const stagedSave = stageReviewSave(saveText);
mkdirSync(outputDir, { recursive: true });
const report: Record<string, unknown>[] = [];

/** The base worktree's water and terrain shader sources for this quality's material variants. */
const baseSources = async (quality: QualityLevel) => {
  if (!baseClient) return null;
  const materials = await import(resolve(baseClient, "src/renderers/three/three-materials.ts"));
  const { QUALITY_PRESETS } = await import(resolve(baseClient, "src/render-common/quality.ts"));
  const preset = QUALITY_PRESETS[quality];
  const water = materials.createWaterMaterial({}, preset.refraction);
  const terrain = materials.createTerrainMaterial({}, null, null, preset.liteGround ? "lite" : "full");
  return { terrain: terrain.fragmentShader as string, water: water.fragmentShader as string,
    waterVertex: water.vertexShader as string };
};

/** Finds the live water, terrain and wake materials in the scenes the next draw renders. */
const collectMaterials = (page: Page, base: Awaited<ReturnType<typeof baseSources>>) =>
  page.evaluate(base => {
    const debug = (window as any).__atmosphereLiveDebug, renderer = debug.renderer;
    const found = { fish: new Set<any>(), terrain: new Set<any>(), wake: new Set<any>(), water: new Set<any>() };
    const native = renderer.render;
    renderer.render = function(scene: any, camera: any) {
      scene.traverse((object: any) => {
        const material = object.material;
        if (!material?.fragmentShader) return;
        if (material.uniforms?.uRefraction && material.vertexShader.includes("getSwell")) found.water.add(material);
        if (material.uniforms?.uGroundAlbedo && material.fragmentShader.includes("waterlineGround"))
          found.terrain.add(material);
        if (material.vertexShader.includes("in vec4 wake")) found.wake.add(object);
        if (/in vec4 (iMotion|iShadow);/.test(material.vertexShader)) found.fish.add(material);
      });
      return native.call(this, scene, camera);
    };
    debug.draw();
    renderer.render = native;
    const lane = (material: any) => ({ fragment: material.fragmentShader, vertex: material.vertexShader });
    debug.costAb = {
      lane: new Map([...found.water, ...found.terrain].map(material => [material, lane(material)])),
      fish: [...found.fish], terrain: [...found.terrain], wake: [...found.wake], water: [...found.water]
    };
    debug.costAb.fishDrawn = () => (window as any).__fishSchools?.fish.active.reduce((sum: number, value: number) =>
      sum + value, 0) ?? 0;
    debug.costAb.useShaders = (variant: "base" | "lane") => {
      for (const material of [...debug.costAb.water, ...debug.costAb.terrain]) {
        if (!base) return;
        const original = debug.costAb.lane.get(material);
        const isWater = debug.costAb.water.includes(material);
        const baseFragment = isWater ? base.water : base.terrain;
        material.fragmentShader = variant === "base" ? baseFragment : original.fragment;
        if (isWater) material.vertexShader = variant === "base" ? base.waterVertex : original.vertex;
        material.needsUpdate = true;
      }
    };
    return { fish: found.fish.size, fishActive: debug.costAb.fishDrawn(), terrain: found.terrain.size,
      wake: found.wake.size, water: found.water.size };
  }, base);

/**
 * ABBA pairs of timed whole-frame draws; `apply(variant)` switches before each draw. Returns the
 * median and mean of lane minus base in ms (`b` stands for the lane/visible variant).
 */
const timePairs = (page: Page, mode: CostMode, count: number) => page.evaluate(async ({ count, mode }) => {
  const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  if (!timer) throw new Error("No GPU timer query");
  const appliers: Record<string, (variant: "a" | "b") => void> = {
    control: () => {},
    fish: variant => { for (const material of debug.costAb.fish) material.visible = variant === "b"; },
    reflection: variant => (window as any).__ssr?.(variant === "b"),
    shaders: variant => debug.costAb.useShaders(variant === "a" ? "base" : "lane"),
    wake: variant => { for (const mesh of debug.costAb.wake) mesh.material.visible = variant === "b"; }
  };
  const apply = appliers[mode]!;
  const frame = () => new Promise(done => requestAnimationFrame(done));
  const timed = async (variant: "a" | "b") => {
    apply(variant);
    debug.draw();
    gl.finish();
    const query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    debug.draw();
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    for (let wait = 0; wait < 60 && !gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE); wait++) await frame();
    const ms = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(query);
    return gl.getParameter(timer.GPU_DISJOINT_EXT) ? NaN : ms;
  };
  for (const variant of ["a", "b", "a", "b"] as const) await timed(variant);
  const differences: number[] = [], a: number[] = [], b: number[] = [];
  for (let pair = 0; pair < count; pair++) {
    const order = pair % 2 === 0 ? ["a", "b"] as const : ["b", "a"] as const;
    const times: Record<string, number> = {};
    for (const variant of order) times[variant] = await timed(variant);
    if (Number.isNaN(times.a! + times.b!)) continue;
    a.push(times.a!);
    b.push(times.b!);
    differences.push(times.b! - times.a!);
  }
  apply("b");
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? NaN;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return { aMedian: median(a), bMedian: median(b), deltaMean: mean(differences), deltaMedian: median(differences),
    samples: differences.length };
}, { count, mode });

const measure = async (page: Page, quality: string, view: string, mode: CostMode) => {
  const result = await timePairs(page, mode, pairs);
  report.push({ mode, quality, view, ...result });
  writeFileSync(resolve(outputDir, "cost-ab.json"), JSON.stringify(report, null, 2));
  console.log(`${quality} ${view} ${mode}: base/hidden ${result.aMedian.toFixed(3)} ms, lane/shown ` +
    `${result.bMedian.toFixed(3)} ms, delta median ${result.deltaMedian.toFixed(3)} mean ` +
    `${result.deltaMean.toFixed(3)} (n=${result.samples})`);
};

const measurePage = async (page: Page, quality: QualityLevel) => {
  const sites = await prepareScene(page);
  const base = await baseSources(quality);
  await pinLight(page, "day");
  await setIsoView(page, { centerX: sites.camera.centerX, centerZ: sites.camera.centerZ, zoom: sites.camera.zoom });
  await sailShip(page, 8);
  console.log("materials", JSON.stringify(await collectMaterials(page, base)));
  const measureModes = async (view: string) => {
    for (const mode of modes) if (mode !== "wake" || quality !== "minimal") await measure(page, quality, view, mode);
  };
  await measureModes("iso");
  await enterPossessed(page);
  await setPossessedView(page, "ship");
  await sailShip(page, 8);
  await collectMaterials(page, base);
  await measureModes("possessed");
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const { page } = await openReviewPage(browser, url, quality, stagedSave, { height: 1080, width: 1920 });
    await measurePage(page, quality);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
