import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "../bench/browser";
import {
  aimPossessed, openFrozenPage, pinScene, stageFrozenSave
} from "../bench/frozen-frame-review";
import {
  assertRendererActive, CAPTURES, createSeedSave, type DiffStats, enterPossessed, HIDE_UI, OWNER_SAVE,
  PARITY_VIEWPORT, type ParityRenderer, settleFrame, writeDiffPng
} from "../bench/parity-helpers";

/**
 * TOOL-3 renderer axis (WG-1b): the same frozen S1/S2 frame under WebGL, native WebGPU and
 * WebGPU's forced WebGL2 backend, with a x16 diff image and statistics. Run it through
 * `captures/browser-slot.sh`; native WebGPU screenshots need headed Chrome on this Linux host and
 * `WEBGPU_ANGLE=gl` keeps WebGL2 available while exposing the native adapter.
 *
 *   HEADED=1 WEBGPU=1 WEBGPU_ANGLE=gl OUTPUT_DIR=<captures>/wg-1b \
 *     <captures>/browser-slot.sh npx tsx tools/review/renderer-parity.ts
 */
type Renderer = ParityRenderer;
type SceneKey = "s1" | "s2";

/** S2 possessed eye pose; PARITY_S2_AIM (JSON) aims the close rock/cliff views. */
const S2_AIM = JSON.parse(process.env.PARITY_S2_AIM ??
  '{"pitch":-0.12,"x":100,"yaw":0,"z":52}') as
  { pitch: number; x: number; yaw: number; z: number };

const OUT = resolve(process.env.OUTPUT_DIR ?? join(CAPTURES, "wg-1b"));
const SEED_SAVE = join(OUT, "seed-123-save.json");
const RENDERERS = (process.env.PARITY_RENDERERS?.split(",") ?? ["webgl", "webgpu", "webgpu-gl"])
  .filter((value): value is Renderer => value === "webgl" || value === "webgpu" || value === "webgpu-gl");
const SCENES = (process.env.PARITY_SCENES?.split(",") ?? ["s1", "s2"])
  .filter((value): value is SceneKey => value === "s1" || value === "s2");
/** Time of day pinned for every scene (dawn/day/dusk/night or an hour number). */
const HOUR = process.env.PARITY_HOUR ?? "day";
/** Optional forced possessed cloud cover (development sky/cloud review). */
const CLOUD_COVER = process.env.PARITY_CLOUD;
/** Possessed look direction and the iso camera placement for sky-visible captures. */
const PITCH = Number(process.env.PARITY_PITCH ?? S2_AIM.pitch);
const YAW = Number(process.env.PARITY_YAW ?? S2_AIM.yaw);
const ISO_CENTER = (process.env.PARITY_ISO_CENTER?.split(",") ?? ["170", "68"]).map(Number);
const ISO_ZOOM = Number(process.env.PARITY_ISO_ZOOM ?? 0.75);
const ISO_TILT = Number(process.env.PARITY_ISO_TILT ?? 0);
/**
 * Scene target switch (`?hdr=`): `off` by default (no post on WebGL, the WG-1b baseline);
 * PARITY_HDR=preset keeps the preset's own target, so WebGL runs its bloom, AO and exposure.
 */
const HDR_QUERY = process.env.PARITY_HDR === "preset" ? "" : `&hdr=${process.env.PARITY_HDR ?? "off"}`;

const freezeS1 = async (page: Page) => {
  await page.evaluate(({ center, tilt, zoom }) => {
    const debug = (globalThis as any).__atmosphereLiveDebug;
    debug.freeze();
    const frame = debug.frozenFrame;
    Object.assign(frame.camera, { centerX: center[0], centerZ: center[1], tilt, yaw: 0,
      zoom });
    frame.time = 12;
    debug.stripDynamic(frame);
    debug.frozenFrame = frame;
    debug.draw();
  }, { center: ISO_CENTER, tilt: ISO_TILT, zoom: ISO_ZOOM });
  await settleFrame(page);
};

const capture = async (browser: Browser, url: string, scene: SceneKey, renderer: Renderer,
  saveText: string, label: string) => {
  const { errors, page } = await openFrozenPage(browser, url, {
    quality: "high",
    query: `&renderer=${renderer}${HDR_QUERY}`,
    stagedSave: stageFrozenSave(saveText),
    viewport: PARITY_VIEWPORT
  });
  try {
    await assertRendererActive(page, renderer);
    if (scene === "s1") {
      await page.evaluate(({ center, zoom }) =>
        (globalThis as any).__settlement?.focusGround?.(center[0], center[1], zoom),
      { center: ISO_CENTER, zoom: ISO_ZOOM });
      await page.waitForTimeout(1000);
    }
    await pinScene(page, HOUR, true);
    if (CLOUD_COVER !== undefined)
      await page.evaluate(cover => { (globalThis as any).__skyCloudCover = Number(cover); },
        CLOUD_COVER);
    if (scene === "s1") {
      await freezeS1(page);
    } else {
      await enterPossessed(page);
      await aimPossessed(page, { pitch: PITCH, x: S2_AIM.x, yaw: YAW, z: S2_AIM.z });
      await settleFrame(page);
    }
    await page.addStyleTag({ content: HIDE_UI });
    await page.waitForTimeout(400);
    const file = join(OUT, `${scene}-${label}.png`);
    await page.screenshot({ clip: { height: PARITY_VIEWPORT.height, width: PARITY_VIEWPORT.width, x: 0, y: 0 },
      path: file });
    return { errors, file };
  } finally {
    await page.close();
  }
};

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const ownerSave = readFileSync(OWNER_SAVE, "utf8");
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const errors: string[] = [];
  const results: Array<{ scene: SceneKey; comparison: string; stats: DiffStats }> = [];
  try {
    const seedSave = existsSync(SEED_SAVE) ? readFileSync(SEED_SAVE, "utf8") :
      await createSeedSave(browser, url, { name: "WG-1b seed 123", path: SEED_SAVE });
    for (const scene of SCENES) {
      const saveText = scene === "s1" ? ownerSave : seedSave;
      const shots: Partial<Record<string, string>> = {};
      for (const renderer of RENDERERS) {
        const shot = await capture(browser, url, scene, renderer, saveText, renderer);
        shots[renderer] = shot.file;
        errors.push(...shot.errors.map(error => `${scene}/${renderer}: ${error}`));
      }
      const repeat = shots.webgl === undefined ? undefined :
        await capture(browser, url, scene, "webgl", saveText, "webgl-repeat");
      if (repeat !== undefined) {
        shots["webgl-repeat"] = repeat.file;
        errors.push(...repeat.errors.map(error => `${scene}/webgl-repeat: ${error}`));
      }
      for (const comparison of ["webgpu", "webgpu-gl", "webgl-repeat"] as const) {
        if (shots[comparison] === undefined || shots.webgl === undefined) continue;
        const stats = await writeDiffPng(browser, shots.webgl, shots[comparison],
          join(OUT, `diff-${scene}-${comparison}.png`));
        results.push({ comparison, scene, stats });
      }
      if (shots.webgpu !== undefined && shots["webgpu-gl"] !== undefined)
        results.push({ comparison: "webgpu-vs-gl", scene,
          stats: await writeDiffPng(browser, shots.webgpu, shots["webgpu-gl"],
            join(OUT, `diff-${scene}-webgpu-vs-gl.png`)) });
    }
    writeFileSync(join(OUT, "parity.json"), JSON.stringify({ errors, generatedAt: new Date().toISOString(),
      results }, null, 2));
    const lines = ["# TOOL-3 renderer parity", "",
      "| Scene | Comparison | Changed pixels % | Mean channel | Max channel | Pixels over 4 levels % |",
      "| --- | --- | --- | --- | --- | --- |",
      ...results.map(({ comparison, scene, stats }) =>
        `| ${scene.toUpperCase()} | ${comparison} | ${stats.changedPixels.toFixed(4)} | ` +
        `${stats.meanChannel.toFixed(6)} | ${stats.maxChannel} | ${stats.overThreshold.toFixed(4)} |`)];
    writeFileSync(join(OUT, "parity.md"), `${lines.join("\n")}\n`);
    console.log(lines.join("\n"));
    assert.equal(errors.length, 0, "page errors");
    console.log(`Renderer parity: ${OUT}`);
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
