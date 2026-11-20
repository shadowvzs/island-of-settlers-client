import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import {
  aimPossessed,
  captureFrame,
  enterPossessed,
  freezeIso,
  openFrozenPage,
  pinScene,
  type PossessedEye,
  stackHorizontally,
  stageFrozenSave
} from "./frozen-frame-review";

/**
 * WALL-PATCHES review: frozen owner-save frames at possessed eyes and iso spots, each captured as the
 * shaded frame and the AO-only view. `EXPERIMENT` applies a diagnostic before capturing:
 * `list` reports the stencil-writing meshes, `hide-excluded` hides the AO-excluded ones, `hide-rock`
 * hides the rock meshes, `transparent` lists transparent meshes, `excluded-first-key` draws AO-excluded
 * materials after every opaque surface of the main scene, `no-baked-ao` drops the ground's baked
 * horizon occlusion (a route), `peaks` prints the highest local summits, `baked-ao` its histogram.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITY=high] [SCENE=day] [VIEWPORT=1600x900]
 *   [QUERY=&ao=strong] [EYES='[{"name":"hq","x":170,"z":74,"yaw":3.1,"pitch":0.05}]']
 *   [SPOTS='[{"name":"m","x":1,"z":2,"zoom":3}]'] [TAG=before]
 *   [PIN='{"hour":9.35,"rain":0.83,"cloud":0.87}'] (pinned light/weather instead of SCENE's clear sky)
 *   [EXPERIMENT=…] [DEFAULT_SORT=1] (Three's own opaque order, the pre-fix order within one build)
 *
 * The source save is only read. Browsers run through captures/browser-slot.sh.
 */
interface NamedEye extends PossessedEye { name: string }
interface IsoSpot { name: string; x: number; yaw?: number; z: number; zoom: number }

const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1600x900").split("x").map(Number);
const quality = process.env.QUALITY ?? "high";
const scene = process.env.SCENE ?? "day";
const query = process.env.QUERY ?? "";
const tag = process.env.TAG ?? "frame";
const experiment = process.env.EXPERIMENT ?? "none";
const defaultSort = process.env.DEFAULT_SORT === "1";
const pin: { cloud: number; hour: number; rain: number } | null =
  process.env.PIN ? JSON.parse(process.env.PIN) : null;
const eyes: NamedEye[] = JSON.parse(process.env.EYES ?? "[]");
const spots: IsoSpot[] = JSON.parse(process.env.SPOTS ?? "[]");
const saveText = readFileSync(sourcePath, "utf8");
mkdirSync(outputDir, { recursive: true });

/** Collects every scene one frame draws, then reports or hides meshes by the experiment. */
const applyExperiment = (page: Page, name: string) => page.evaluate(mode => {
  const debug = (window as any).__atmosphereLiveDebug, renderer = debug.renderer;
  const scenes = new Set<any>();
  const native = renderer.render;
  renderer.render = function(passScene: any, camera: any) {
    scenes.add(passScene);
    return native.call(this, passScene, camera);
  };
  debug.draw();
  renderer.render = native;
  const excluded: string[] = [];
  for (const passScene of scenes) passScene.traverse((object: any) => {
    const materials = [object.material].flat().filter(Boolean);
    if (mode === "hide-rock") {
      if (materials.some((m: any) => m.uniforms?.uRockTexture)) {
        excluded.push(`${object.name || object.type}|${object.parent?.name}`);
        object.visible = false;
      }
      return;
    }
    if (mode === "transparent") {
      const transparent = materials.filter((m: any) => m.transparent && object.visible);
      if (transparent.length) excluded.push(`${object.name || object.type}|${object.parent?.name}|`
        + transparent.map((m: any) => `${m.type}:${m.name}:${m.opacity}`).join(","));
      return;
    }
    if (!materials.some((material: any) => material.stencilWrite)) return;
    const describe = (m: any) => {
      const hints = Object.keys(m.uniforms ?? {}).filter(key => /Sprite|Water|Fall|Paddy/.test(key)).join("+");
      return `${m.type}#${m.id}/${hints}/ref${m.stencilRef}/zp${m.stencilZPass}/f${m.stencilFunc}`;
    };
    excluded.push(`${object.name || object.type}:${object.renderOrder}:${materials.map(describe).join(",")}`
      + `:${object.visible}`);
    if (mode === "hide-excluded" && materials.some((m: any) => m.stencilRef === 0x80 && m.stencilZPass === 7681))
      object.visible = false;
  });
  return excluded;
}, name);

/** Diagnostic route: the ground shader ignores the baked horizon occlusion (vShading.y). */
const removeBakedGroundOcclusion = async (page: Page) => {
  await page.route("**/three-materials.ts*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("getCliffOcclusion(vShading.y, groundNormal)", "1.0");
    await route.fulfill({ body, response });
  });
};

const setAoView = (page: Page, view: number) => page.evaluate(value => {
  const tune = (window as any).__aoTuning;
  if (tune) tune({ view: value });
}, view);

const captureBoth = async (page: Page, name: string) => {
  await setAoView(page, 0);
  await captureFrame(page, outputDir, `${name}-${tag}`, 30);
  await setAoView(page, 1);
  await captureFrame(page, outputDir, `${name}-${tag}-ao`, 30);
  await setAoView(page, 0);
  stackHorizontally(resolve(outputDir, `${name}-${tag}-sheet.png`),
    [`${name}-${tag}`, `${name}-${tag}-ao`].map(file => resolve(outputDir, `${file}.png`)));
};

const aimIso = (page: Page, spot: IsoSpot) => page.evaluate(target => {
  const debug = (window as any).__atmosphereLiveDebug;
  const frame = debug.snapshotFrame(debug.isoFrame);
  Object.assign(frame.camera, { centerX: target.x, centerZ: target.z, zoom: target.zoom });
  if (target.yaw !== undefined) frame.camera.yaw = target.yaw;
  frame.time = 12;
  debug.stripDynamic(frame);
  debug.frozenFrame = frame;
  debug.draw();
}, spot);

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const { errors, page } = await openFrozenPage(browser, url, {
    extraRoutes: experiment === "no-baked-ao" ? removeBakedGroundOcclusion : undefined,
    query, quality, stagedSave: stageFrozenSave(saveText), viewport: { height: height!, width: width! }
  });
  if (errors.length) throw new Error(errors.join(" | "));
  if (experiment === "excluded-first-key") await page.evaluate(() => {
    const renderer = (window as any).__atmosphereLiveDebug.renderer, stats: Record<string, number> = {};
    const flag = (item: any) => Number(item.material.stencilWrite && item.material.stencilRef === 0x80);
    (window as any).__sortStats = stats;
    renderer.setOpaqueSort((a: any, b: any) => {
      for (const item of [a, b]) stats[`${flag(item)}:${item.groupOrder}:${item.renderOrder}`] = 1;
      return flag(a) - flag(b) || a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
        || a.material.id - b.material.id || a.z - b.z || a.id - b.id;
    });
  });
  if (defaultSort) await page.evaluate(() => (window as any).__atmosphereLiveDebug.renderer.setOpaqueSort(null));
  await pinScene(page, scene, true);
  if (pin) await page.evaluate(async ({ cloud, hour, rain }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { computeEnvironment } = await load("/src/render-common/environment.ts");
    debug.pinned = computeEnvironment(debug.world.sun, hour, rain, 0, cloud, 0);
  }, pin);
  await freezeIso(page);
  if (experiment === "peaks") console.log("peaks", JSON.stringify(await page.evaluate(() => {
    const { cellsX, cellsZ, heights } = (window as any).__atmosphereLiveDebug.world, stride = cellsX + 1;
    const peaks: number[][] = [];
    for (let z = 4; z < cellsZ - 4; z += 2) for (let x = 4; x < cellsX - 4; x += 2) {
      const height = heights[z * stride + x];
      if (height < 4) continue;
      let top = true;
      for (let dz = -10; dz <= 10 && top; dz += 2) for (let dx = -10; dx <= 10; dx += 2) {
        const other = heights[Math.min(cellsZ, Math.max(0, z + dz)) * stride + Math.min(cellsX, Math.max(0, x + dx))];
        if (other > height) { top = false; break; }
      }
      if (top) peaks.push([x, z, Math.round(height * 100) / 100]);
    }
    return peaks.sort((a, b) => b[2]! - a[2]!).slice(0, 16);
  })));
  if (experiment === "baked-ao") console.log("baked-ao", JSON.stringify(await page.evaluate(() => {
    const { ambientOcclusion, heights } = (window as any).__atmosphereLiveDebug.world;
    const bins = new Array(8).fill(0), low = new Array(8).fill(0);
    for (let index = 0; index < heights.length; index++) {
      const bin = Math.min(7, Math.floor(ambientOcclusion[index] / 32));
      (heights[index] > 4 ? bins : low)[bin]++;
    }
    const { cellsX } = (window as any).__atmosphereLiveDebug.world, darkest: number[][] = [];
    for (let index = 0; index < heights.length; index++)
      if (heights[index] > 5 && ambientOcclusion[index] < 110)
        darkest.push([index % (cellsX + 1), Math.floor(index / (cellsX + 1)), ambientOcclusion[index],
          Math.round(heights[index] * 10) / 10]);
    return { darkest: darkest.slice(0, 60), lowland: low, mountain: bins };
  })));
  for (const spot of spots) {
    await aimIso(page, spot);
    await page.waitForTimeout(1500);
    if (experiment !== "none") console.log(spot.name, await applyExperiment(page, experiment));
    await captureBoth(page, `${quality}-${scene}-iso-${spot.name}`);
  }
  if (eyes.length) await enterPossessed(page);
  for (const { name, ...eye } of eyes) {
    await aimPossessed(page, eye);
    await page.waitForTimeout(1500);
    if (experiment !== "none") console.log(name, JSON.stringify([...new Set(await applyExperiment(page, experiment))]));
    await captureBoth(page, `${quality}-${scene}-eye-${name}`);
    console.log(name, JSON.stringify(await page.evaluate(() => (window as any).__sortStats ?? null)));
  }
} finally {
  await browser.close();
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
console.log("done");
