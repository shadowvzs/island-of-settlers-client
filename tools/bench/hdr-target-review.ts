import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { patchAtmosphereLiveCost, patchAtmosphereWeatherClock } from "./atmosphere-live-cost-patch";
import { launchBrowser, startDevServer } from "./browser";

/**
 * R10 review (frame compositor scene target): the real game path with frozen frames (pinned light,
 * camera, actors and presentation clock), so two page loads, or `?hdr=off` against `?hdr=rgba8`, give
 * pixel-comparable shots. Environment:
 * - OUTPUT (required): folder for PNGs and `report-<TAG>.json`.
 * - MODE: `capture` (default) or `timing`.
 * - SCENES (day,dusk,night,rain), QUALITIES (high,minimal), VIEWS
 *   (iso-default,iso-close,possessed-eye,spyglass), HDR (omit, or a list of `?hdr=` values such as
 *   `off,rgba8`; `off|rgba8|rgba16f`, 0 and 1 alias off and rgba16f).
 * - Timing: SAMPLES per run (48) and RUNS (3) per page, at 1920×1080 on High; list a variant more
 *   than once (HDR=off,rgba8,off,rgba8) to alternate them over time, so a shared, busy GPU biases both
 *   equally.
 * - DEPTH=1 requests the resolved depth texture (`?depth=1`, R12a); MASTER_COMPOSITOR=1 serves the
 *   master frame-compositor as the "before" image (R12a pixel parity).
 * - R11a linear output: `LINEAR=1` adds a `-linear` shot (scene target plus the linear output pass)
 *   to every AB sequence; in timing mode `LINEAR` pairs one flag per HDR entry
 *   (HDR=rgba8,rgba8 LINEAR=0,1).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const mode = process.env.MODE ?? "capture";
const tag = process.env.TAG ?? mode;
const list = (value: string | undefined, fallback: string) => (value ?? fallback).split(",");
const scenes = list(process.env.SCENES, mode === "timing" ? "day" : "day,dusk,night,rain");
const qualities = list(process.env.QUALITIES, mode === "timing" ? "high" : "high,minimal");
const views = list(process.env.VIEWS, "iso-default,iso-close,possessed-eye,spyglass");
const hdrVariants = list(process.env.HDR, "");
const samples = Number(process.env.SAMPLES ?? 48);
const runs = Number(process.env.RUNS ?? 3);
const viewport = mode === "timing" ? { height: 1080, width: 1920 } : { height: 900, width: 1600 };
/** AB=1: every shot from one frozen frame as `-direct`, `-hdr`, `-direct2` (needs a scene target in HDR). */
const abMode = process.env.AB === "1";
/** LINEAR=1 adds `-linear` (scene target plus the R11a linear output pass) to the AB sequence. */
const linearMode = process.env.LINEAR === "1";
/** Timing pairs one LINEAR flag per HDR entry (`HDR=rgba8,rgba8 LINEAR=0,1`). */
const linearVariants = list(process.env.LINEAR, "0").map(value => value === "1");
if (mode === "timing" && process.env.LINEAR)
  assert.equal(linearVariants.length, hdrVariants.length, "LINEAR pairs one flag per HDR entry");
const linearFor = (index: number) =>
  linearVariants[index] ?? linearVariants[linearVariants.length - 1] ?? false;
/**
 * SCREEN=1: shots are `page.screenshot` composites (what the player sees, canvas alpha over the
 * page backdrop) instead of `toDataURL`, which un-premultiplies canvas alpha.
 */
const screenMode = process.env.SCREEN === "1";
/** WARMUP: draws of the frozen frame before each view's first shot (default 30). */
const warmUpDraws = Number(process.env.WARMUP ?? 30);
/** QUERY: extra game dev switches appended to the URL (for example `tonemap=neutral`). */
const extraQuery = process.env.QUERY ? `&${process.env.QUERY}` : "";
/** INIT: an extra diagnostic init script (for example a GL state override). */
/** Diagnostic source replacements, PATCHES='[{"file":"x.ts","from":"regex","to":"b"}]' (never on disk). */
const sourcePatches: { file: string; from: string; to: string }[] = JSON.parse(process.env.PATCHES ?? "[]");
/**
 * MASTER_COMPOSITOR=1 serves the master frame-compositor (the file before this lane) as the "before"
 * image. Vite only transforms files inside the project, so the master source is staged as a sibling
 * module (same relative imports) and its transformed body answers the lane module's URL; the staged
 * file is removed when the tool exits.
 */
const masterCompositor = process.env.MASTER_COMPOSITOR === "1";
const clientRoot = resolve(import.meta.dirname, "../..");
const masterModulePath = resolve(clientRoot, "src/renderers/three/r12a-master-frame-compositor.ts");
/** DEPTH=1 appends ?depth=1: the first R12a consumer request (resolved depth texture). */
const depthRequested = process.env.DEPTH === "1";
assert(!(masterCompositor && depthRequested), "MASTER_COMPOSITOR=1 has no useDepth; do not combine with DEPTH=1");
/** Island load limit (a busy shared GPU slows the first frames). */
const LOAD_TIMEOUT_MS = 300_000;
const COAST_DEG = 290;
const FOREST_DEG = 200;
const SCENE_URL: Record<string, string> = {
  day: "&time=day", dusk: "&time=dusk", night: "&time=night", rain: "&time=day&rain=1"
};
const report: Record<string, any> = { ab: [], errors: [], mode, pages: [], shots: [], timing: [] };
const save = () => writeFileSync(resolve(output, `report-${tag}.json`), JSON.stringify(report, null, 2));

const patchRoutes = async (page: Page, url: string) => {
  await page.addInitScript("window.__name = value => value");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  if (masterCompositor) await page.route("**/src/renderers/three/frame-compositor.ts", async route => {
    const response = await route.fetch();
    const transformed = await fetch(`${url}src/renderers/three/r12a-master-frame-compositor.ts`);
    assert(transformed.ok, "staged master compositor module did not load");
    await route.fulfill({ body: await transformed.text(), response });
  });
  await page.route("**/create-three-renderer.ts", async route => {
    const response = await route.fetch();
    const body = patchAtmosphereLiveCost(await response.text())
      .replace("atmosphereDebug.api = result;", "atmosphereDebug.world = world; atmosphereDebug.api = result;")
      // Pinned light: let the sky environment rebake on the next frames (1000× clock).
      .replace("skyEnvironment?.update(environment, performance.now() / 1000)",
        "skyEnvironment?.update(environment, performance.now())");
    await route.fulfill({ body, response });
  });
  await page.route("**/renderer-context-options.ts", async route => {
    const response = await route.fetch();
    const source = await response.text();
    // Same-frame A/B: the canvas keeps its MSAA, so `__sceneTarget(false)` is the direct path.
    const body = abMode ? source.replace(" && sceneTarget === \"off\"", "") : source;
    await route.fulfill({ body, response });
  });
  await page.route("**/exploration-weather-adapter.ts", async route => {
    const response = await route.fetch();
    await route.fulfill({ body: patchAtmosphereWeatherClock(await response.text()), response });
  });
  for (const { file, from, to } of sourcePatches) await page.route(`**/${file}`, async route => {
    const response = await route.fetch(), source = await response.text();
    // A regular expression: the served code is esbuild's formatting, not the file's.
    const anchor = new RegExp(from, "g");
    assert(anchor.test(source), `${file}: patch anchor missing`);
    await route.fulfill({ body: source.replace(anchor, to), response });
  });
};

/**
 * Counts explicit framebuffer blits (MSAA resolves) per manual draw, and the draw calls per bound
 * draw framebuffer in order (`__drawTargets`: runs of [framebuffer id, draws]), which shows that
 * every world layer lands in the scene target.
 */
const BLIT_COUNTER = `(() => {
  const proto = WebGL2RenderingContext.prototype, blit = proto.blitFramebuffer;
  const bind = proto.bindFramebuffer, ids = new WeakMap();
  let bound = 0, next = 1;
  window.__blits = 0;
  window.__drawTargets = [];
  proto.blitFramebuffer = function (...args) { window.__blits++; return blit.apply(this, args); };
  proto.bindFramebuffer = function (target, framebuffer) {
    if (target !== this.READ_FRAMEBUFFER) {
      if (framebuffer && !ids.has(framebuffer)) ids.set(framebuffer, next++);
      bound = framebuffer ? ids.get(framebuffer) : 0;
    }
    return bind.call(this, target, framebuffer);
  };
  for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    const draw = proto[name];
    proto[name] = function (...args) {
      const runs = window.__drawTargets, last = runs[runs.length - 1];
      if (last && last[0] === bound) last[1]++; else runs.push([bound, 1]);
      return draw.apply(this, args);
    };
  }
})()`;

const openPage = async (browser: Browser, url: string, scene: string, quality: string, hdr: string) => {
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 300));
  });
  await patchRoutes(page, url);
  // Full resolution throughout: the adaptive controller (R09) would resize the drawing buffer
  // mid-sequence and break same-frame pixel comparisons.
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY,
    value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await page.addInitScript(BLIT_COUNTER);
  if (process.env.INIT) await page.addInitScript(process.env.INIT);
  const hdrParam = hdr === "" ? "" : `&hdr=${hdr}`;
  const depthParam = depthRequested ? "&depth=1" : "";
  const query = `quality=${quality}&size=128&seed=123&cache=0&skipLogin=1&reveal=1${SCENE_URL[scene]}` +
    `${hdrParam}${depthParam}${extraQuery}`;
  await page.goto(`${url}?${query}`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: LOAD_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: LOAD_TIMEOUT_MS });
  if (scene === "rain") await page.waitForFunction(() =>
    (window as any).__atmosphereLiveDebug.lastFrame.environment.rain > 0.95, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);
  const device = await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug, gl = debug.renderer.getContext();
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return { antialias: gl.getContextAttributes().antialias, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      canvasSamples: gl.getParameter(gl.SAMPLES), renderer: gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
      scene: debug.api.getStats().details.sceneTarget ?? "off",
      sceneSamples: debug.api.getStats().details.sceneSamples ?? 0 };
  });
  if (!/NVIDIA/.test(device.renderer) || /swiftshader/i.test(device.renderer))
    throw new Error(`Not the hardware GPU: ${device.renderer}`);
  await pinScene(page, scene);
  const info = { depth: depthRequested, device, errors, hdr, quality, scene };
  report.pages.push(info);
  return { info, page };
};

/** Pins the light of the scene and a fixed presentation clock on every drawn frame. */
const pinScene = (page: Page, scene: string) => page.evaluate(async sceneName => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const { snapshotAtmosphereFrame } = await load("/tools/bench/atmosphere-frame-snapshot.ts");
  const { computeEnvironment, TIME_PRESETS } = await load("/src/render-common/environment.ts");
  const hours: Record<string, number> = { day: TIME_PRESETS.day, dusk: TIME_PRESETS.dusk,
    night: TIME_PRESETS.night, rain: TIME_PRESETS.day };
  const rain = sceneName === "rain" ? 1 : 0;
  debug.pinned = computeEnvironment(debug.world.sun, hours[sceneName], rain, 0, 0.45 + rain * 0.5, 0);
  debug.snapshotFrame = (frame: any) => {
    const snapshot = snapshotAtmosphereFrame(frame);
    snapshot.environment = structuredClone(debug.pinned);
    snapshot.time = 12;
    return snapshot;
  };
  debug.renderer.info.autoReset = false;
}, scene);

const freezeIso = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug;
  debug.freeze();
  debug.isoFrame = debug.snapshotFrame(debug.frozenFrame);
  return { camera: debug.frozenFrame.camera, hq: debug.frozenFrame.buildings[0] };
});

const setIsoCamera = (page: Page, centerX: number, centerZ: number, zoom: number) =>
  page.evaluate(({ centerX, centerZ, zoom }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.frozenFrame = debug.snapshotFrame(debug.isoFrame);
    Object.assign(debug.frozenFrame.camera, { centerX, centerZ, zoom });
  }, { centerX, centerZ, zoom });

const enterPossessed = async (page: Page) => {
  await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozen = false; });
  await page.evaluate(() => (document.querySelector("[data-exploration-entry]") as HTMLElement).click());
  await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().phase === "possessed",
    null, { timeout: 60_000 });
  await page.waitForTimeout(2500);
};

const sunDegrees = (page: Page) => page.evaluate(() => {
  const sun = (window as any).__atmosphereLiveDebug.pinned.sun;
  return ((Math.atan2(sun.azimuthX, sun.azimuthZ) * 180 / Math.PI) % 360 + 360) % 360;
});

const freezePossessed = (page: Page, degrees: number, pitch: number) =>
  page.evaluate(({ degrees, pitch }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.freeze();
    const pose = debug.frozenFrame.exploration.camera.pose;
    pose.yaw = degrees * Math.PI / 180;
    pose.pitch = pitch;
  }, { degrees, pitch });

const raiseSpyglass = async (page: Page) => {
  await page.evaluate(() => { (window as any).__atmosphereLiveDebug.frozen = false; });
  await page.evaluate(() => {
    const controller = (window as any).__exploration.controller;
    controller.toggleSpyglass();
    for (let step = 0; step < 10; step++) controller.adjustSpyglassZoom(1);
  });
  await page.waitForFunction(() => {
    const pose = (window as any).__atmosphereLiveDebug.lastFrame.exploration?.camera?.pose;
    return pose && Math.abs(pose.fov - (34 / 1.5 * Math.PI / 180) * 3 / 4) < 0.004;
  }, null, { timeout: 15_000 });
  await page.waitForTimeout(800);
};

const drawAndRead = (page: Page) => page.evaluate(() => {
  const debug = (window as any).__atmosphereLiveDebug, renderer = debug.renderer;
  debug.draw();
  (window as any).__blits = 0;
  (window as any).__drawTargets = [];
  debug.draw();
  const blits = (window as any).__blits;
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return { blits, data: renderer.domElement.toDataURL("image/png") as string, draws: debug.lastDraw,
    drawTargets: (window as any).__drawTargets.map((run: number[]) => run.join("x")).join(" "),
    height, pixels, programs: renderer.info.programs?.length ?? 0,
    textures: renderer.info.memory.textures, width };
});

interface ShotPixels {
  height: number;
  pixels: Uint8Array;
  width: number;
}

/** Per-pixel channel difference of two shots: share over 1 and 8 levels, maximum and mean. */
const differenceStats = (before: ShotPixels, after: ShotPixels) => {
  assert.equal(before.pixels.length, after.pixels.length, "Shots of different sizes");
  const pixels = before.pixels.length / 4;
  let changed = 0, maximum = 0, over1 = 0, over8 = 0, total = 0;
  for (let index = 0; index < before.pixels.length; index += 4) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel++) {
      delta = Math.max(delta, Math.abs(before.pixels[index + channel]! - after.pixels[index + channel]!));
    }
    changed += delta > 0 ? 1 : 0;
    over1 += delta > 1 ? 1 : 0;
    over8 += delta > 8 ? 1 : 0;
    maximum = Math.max(maximum, delta);
    total += delta;
  }
  return { changed, maximum, mean: total / pixels, over1, over8, pixels };
};

const shotOnce = async (page: Page, name: string, extra: Record<string, unknown>): Promise<ShotPixels> => {
  await page.evaluate(() => (window as any).__atmosphereLiveDebug.draw());
  await page.waitForTimeout(150);
  const { data, height, pixels, width, ...counts } = await drawAndRead(page);
  if (screenMode) await page.screenshot({ path: resolve(output, name) });
  else writeFileSync(resolve(output, name), Buffer.from(data.split(",")[1]!, "base64"));
  report.shots.push({ height, name, width, ...counts, ...extra });
  save();
  return { height, pixels, width };
};

/** Draws the frozen frame until time-sliced work (shadow casters, impostor swaps) has settled. */
const warmUp = (page: Page) => page.evaluate(async count => {
  const debug = (window as any).__atmosphereLiveDebug;
  for (let index = 0; index < count; index++) {
    debug.draw();
    await new Promise(done => requestAnimationFrame(done));
  }
}, warmUpDraws);

/** A/B: direct, HDR, (linear), direct again; the two direct shots measure the frame's own noise floor. */
const AB_SEQUENCE: ReadonlyArray<readonly [string, boolean, boolean]> = linearMode
  ? [["direct", false, false], ["hdr", true, false], ["linear", true, true], ["direct2", false, false]]
  : [["direct", false, false], ["hdr", true, false], ["direct2", false, false]];

const shot = async (page: Page, name: string, extra: Record<string, unknown>) => {
  await warmUp(page);
  if (!abMode) {
    await shotOnce(page, name, extra);
    return;
  }
  const taken = new Map<string, ShotPixels>();
  for (const [suffix, sceneTarget, linear] of AB_SEQUENCE) {
    await page.evaluate(({ linear, sceneTarget }) => {
      const root = window as any;
      root.__linearOutput?.(linear);
      root.__sceneTarget(sceneTarget);
    }, { linear, sceneTarget });
    taken.set(suffix, await shotOnce(page, name.replace(".png", `-${suffix}.png`), extra));
  }
  if (!linearMode) return;
  report.ab.push({
    linear: differenceStats(taken.get("hdr")!, taken.get("linear")!),
    name,
    noise: differenceStats(taken.get("direct")!, taken.get("direct2")!)
  });
  save();
};

/**
 * COMPILE_CHECK=1: compiles the display-space feedback shaders (health and upgrade bars, hover
 * hull), which only compile once shown, in the game renderer; errors reach the page error log.
 */
const compileFeedbackShaders = (page: Page) => page.evaluate(async () => {
  const debug = (window as any).__atmosphereLiveDebug;
  const load = (path: string) => import(/* @vite-ignore */ path);
  const three = await load("/node_modules/.vite/deps/three.js").catch(() => load("three"));
  const { createBuildingHealthBars } = await load("/src/renderers/three/buildings/building-health-bars.ts");
  const { createBuildingUpgradeBars } = await load("/src/renderers/three/buildings/building-upgrade-bars.ts");
  const { createBuildingHover } = await load("/src/renderers/three/buildings/building-hover.ts");
  const scene = new three.Scene();
  const health = createBuildingHealthBars(), upgrade = createBuildingUpgradeBars();
  health.update([{ health: 0.5, x: 0, y: 0, z: 0 }]);
  upgrade.update([{ progress: 0.5, x: 0, y: 0, z: 0 }]);
  const box = new three.Mesh(new three.BoxGeometry(), new three.MeshBasicMaterial());
  scene.add(health.root, upgrade.root, box);
  createBuildingHover(scene).set(box);
  debug.renderer.compile(scene, new three.PerspectiveCamera());
  const gl = debug.renderer.getContext();
  return (debug.renderer.info.programs ?? []).filter((program: any) => {
    const fragment = gl.getShaderSource(gl.getAttachedShaders(program.program)[1]) ?? "";
    return fragment.includes("colorDisplayOutput(vec3(.95") || fragment.includes("colorDisplayOutput(color)");
  }).map((program: any) => ({ diagnostics: program.diagnostics ?? null,
    linked: gl.getProgramParameter(program.program, gl.LINK_STATUS) }));
});

/** The spyglass looks at the forest by day, into the sun at dusk, over the coast otherwise. */
const spyglassDegrees = (scene: string, sun: number) => {
  if (scene === "day") return FOREST_DEG;
  return scene === "dusk" ? sun : COAST_DEG;
};

const capturePage = async (page: Page, scene: string, quality: string, hdr: string) => {
  if (process.env.COMPILE_CHECK === "1") report.compileCheck = await compileFeedbackShaders(page);
  const suffix = `${quality}${hdr === "" ? "" : `-hdr${hdr}`}${depthRequested ? "-depth" : ""}`;
  const { camera, hq } = await freezeIso(page);
  if (views.includes("iso-default")) {
    await setIsoCamera(page, camera.centerX, camera.centerZ, camera.zoom);
    await shot(page, `${scene}-iso-default-${suffix}.png`, { camera });
  }
  if (views.includes("iso-close")) {
    await setIsoCamera(page, hq.x, hq.z, 1.8);
    await shot(page, `${scene}-iso-close-${suffix}.png`, { zoom: 1.8 });
  }
  if (!views.includes("possessed-eye") && !views.includes("spyglass")) return;
  await enterPossessed(page);
  const towardsSun = scene === "dusk";
  const sun = await sunDegrees(page);
  if (views.includes("possessed-eye")) {
    const degrees = towardsSun ? sun : COAST_DEG, pitch = towardsSun ? 0.06 : 0;
    await freezePossessed(page, degrees, pitch);
    await shot(page, `${scene}-possessed-eye-${suffix}.png`, { pitch, yawDeg: degrees });
  }
  if (!views.includes("spyglass")) return;
  await raiseSpyglass(page);
  const degrees = spyglassDegrees(scene, sun);
  const pitch = towardsSun ? 0.03 : 0;
  await freezePossessed(page, degrees, pitch);
  await shot(page, `${scene}-spyglass-${suffix}.png`, { pitch, yawDeg: degrees, zoom: 4 });
};

/** Stores the iso and possessed frames of a timing page (both replayed by `measure`). */
const prepareTimingPage = async (page: Page) => {
  await page.evaluate(() => (window as any).__atmosphereLiveDebug.api.resize(1920, 1080, 1));
  await freezeIso(page);
  await enterPossessed(page);
  await freezePossessed(page, COAST_DEG, 0);
  await page.evaluate(() => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.fpsFrame = debug.snapshotFrame(debug.frozenFrame);
  });
};

const measure = async (page: Page, view: "iso" | "possessed") => {
  await page.bringToFront();
  return page.evaluate(async ({ count, view }) => {
    const debug = (window as any).__atmosphereLiveDebug;
    debug.frozenFrame = debug.snapshotFrame(view === "possessed" ? debug.fpsFrame : debug.isoFrame);
    await debug.api.prepareFrame(debug.frozenFrame);
    const { measureAtmosphereGpu } = await import(/* @vite-ignore */ String("/tools/bench/atmosphere-gpu.ts"));
    const timing = await measureAtmosphereGpu(debug.renderer, debug.draw, count);
    (window as any).__blits = 0;
    debug.draw();
    return { ...timing, blits: (window as any).__blits, draws: debug.lastDraw,
      linearOutput: debug.api.getStats().details.linearOutput ?? 0 };
  }, { count: samples, view });
};

if (masterCompositor) {
  rmSync(masterModulePath, { force: true });
  const source = execFileSync("git", [
    "show", "master:island-of-settlers-client/src/renderers/three/frame-compositor.ts"
  ], { cwd: clientRoot, encoding: "utf8" });
  writeFileSync(masterModulePath, source);
}
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  if (mode === "timing") {
    // One page at a time (a second page does not load while the first one runs); repeat the HDR list
    // (for example 0,1,0,1) to alternate the variants over time on a shared GPU.
    for (const scene of scenes) for (const quality of qualities) for (const [order, hdr] of hdrVariants.entries()) {
      const linear = linearFor(order);
      const { info, page } = await openPage(browser, url, scene, quality, hdr);
      await prepareTimingPage(page);
      if (linear) await page.evaluate(() => (window as any).__linearOutput?.(true));
      for (let run = 0; run < runs; run++) for (const view of ["iso", "possessed"] as const) {
        const result = await measure(page, view);
        report.timing.push({ depth: depthRequested, hdr, linear, order, quality, run, scene, view, ...result });
        console.log(JSON.stringify({ cpu: result.cpuSubmissionMedianMs, depth: depthRequested,
          gpu: result.gpuMedianMs, hdr, linear, run, view }));
        save();
      }
      report.errors.push(...info.errors.map(error => `${scene}/${quality}/${hdr}: ${error}`));
      await page.close();
    }
  } else {
    for (const scene of scenes) for (const quality of qualities) for (const hdr of hdrVariants) {
      const { info, page } = await openPage(browser, url, scene, quality, hdr);
      await capturePage(page, scene, quality, hdr);
      report.errors.push(...info.errors.map(error => `${scene}/${quality}/${hdr}: ${error}`));
      save();
      await page.close();
    }
  }
} catch (error) {
  report.fatal = String(error);
  throw error;
} finally {
  save();
  await browser.close();
  await server.close();
  if (masterCompositor) rmSync(masterModulePath, { force: true });
}
console.log("done", report.shots.length, "shots,", report.timing.length, "timings");
