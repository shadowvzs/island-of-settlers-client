import assert from "node:assert/strict";

type Page = import("playwright-core").Page;

/** Simulation, worker and ambient updates timed per frame (the render loop's options). */
const TIMED_LOOP_OPTIONS = [
  "updateSettlement", "updateWorkers", "updateEnvironment", "beforeRender", "afterRender",
  "updateFelling", "updateGrowth", "updateBirds", "updateButterflies", "updateAnimals", "updateCritters"
];

const patchRenderLoop = (source: string) => {
  assert(source.includes("const controller = createCameraController"));
  assert(source.includes("renderer.render(drawn);"));
  return source
    .replace("const controller = createCameraController", `
      for (const key of ${JSON.stringify(TIMED_LOOP_OPTIONS)}) {
        const original = options[key];
        if (!original) continue;
        options[key] = (...args) => { const start = performance.now();
          const result = original(...args); window.__ownerTimings[key] = performance.now() - start;
          return result; };
      }
      window.__ownerFrames = [];
      window.__ownerCamera = options.camera;
      const controller = createCameraController`)
    .replace("stats.beginFrame();", "window.__ownerTimings = {}; window.__ownerPasses = []; stats.beginFrame();")
    .replace("const gpuTimer = createGpuTimer", "window.__ownerFrameStats = stats; const gpuTimer = createGpuTimer")
    .replace("renderer.render(drawn);", "window.__ownerRenderStart = performance.now(); renderer.render(drawn);")
    .replace("const cpuMs = performance.now() - cpuStart;", `
      window.__ownerTimings.render = performance.now() - window.__ownerRenderStart;
      window.__ownerTimings.cpu = performance.now() - cpuStart;
      window.__ownerFrames.push({ timings: { ...window.__ownerTimings }, passes: window.__ownerPasses });
      if (window.__ownerFrames.length > 600) window.__ownerFrames.shift();
      const cpuMs = performance.now() - cpuStart;`)
    .replace("options.onStats(stats.summarize());",
      "window.__ownerStats = stats.summarize(); options.onStats(window.__ownerStats);");
};

/** The renderer's per-frame function (its parameter was renamed from `frame` to `input`). */
const RENDER_FUNCTION = /const render = \((\w+)\) => \{/;

const patchThreeRenderer = (source: string) => {
  assert(RENDER_FUNCTION.test(source));
  let patched = source.replace(RENDER_FUNCTION, (_, parameter: string) => `
    const passNames = new Map([[scene, "world"], [shadows.scene, "shadows"],
      [waterfallScene, "waterfalls"], [animalScene, "animals"], [birdScene, "birds"],
      [silhouetteScene, "silhouettes"], [weedScene, "weeds"], [smokeScene, "smoke"]]);
    const actualRender = renderer.render.bind(renderer);
    renderer.render = (passScene, passCamera) => { const start = performance.now();
      const target = renderer.getRenderTarget();
      const result = actualRender(passScene, passCamera);
      window.__ownerPasses?.push({ name: passNames.get(passScene) ?? window.__ownerPassScope ?? "other",
        offscreen: Boolean(target), ms: performance.now() - start,
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
      return result; };
    const trackLayer = (label, target, method) => { if (!target?.[method]) return;
      const original = target[method].bind(target);
      target[method] = (...args) => { const start = performance.now(); const result = original(...args);
        if (window.__ownerTimings) window.__ownerTimings[label] = performance.now() - start; return result; };
    };
    for (const [label, target] of [["vegetation", vegetation], ["rocks", rocks], ["buildings", buildings],
      ["animalsRender", animals], ["ships", ships]]) trackLayer(label, target, "update");
    const render = (${parameter}) => {`);
  for (const [label, call] of [
    ["buildings", "buildings.render(renderer, camera);"],
    ["workers", "worker.current?.render(renderer, camera);"],
    ["mounts", "mounts?.render(renderer, camera);"],
    ["cavalry", "cavalry?.render(renderer, camera);"]
  ] as const)
    patched = patched.replace(call,
      `window.__ownerPassScope = "${label}"; ${call} window.__ownerPassScope = undefined;`);
  patched = patched.replace(/worker\.current\?\.update\(renderedWorkers[^;]*;/, call =>
    `const workerStart = performance.now(); ${call} ` +
    "if (window.__ownerTimings) window.__ownerTimings.workerPose = performance.now() - workerStart;");
  return patched;
};

/** Per-frame CPU of the render loop only (the WG-0 bench: no renderer-source string dependency). */
export const installRenderLoopProfiler = async (page: Page) => {
  await page.route("**/src/app/render-loop.ts", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: patchRenderLoop(await response.text()) });
  });
};

/**
 * Routes the dev server's render loop and Three renderer through timing wrappers: per frame CPU
 * of every loop stage and layer update, and calls / triangles / ms of every render pass.
 */
export const installFrameProfiler = async (page: Page, patchRenderer?: (source: string) => string) => {
  await installRenderLoopProfiler(page);
  await page.route("**/src/renderers/three/create-three-renderer.ts", async (route) => {
    const response = await route.fetch();
    const patched = patchThreeRenderer(await response.text());
    await route.fulfill({ response, body: patchRenderer ? patchRenderer(patched) : patched });
  });
};

/** Drops the recorded frames and frame statistics: the next read covers only later frames. */
export const resetFrameProfile = (page: Page) => page.evaluate(() => {
  (window as any).__ownerFrames = [];
  (window as any).__ownerFrameStats.reset();
});

/** Mean ms per stage and per render pass over the recorded frames, with the frame statistics. */
export const readFrameProfile = (page: Page) => page.evaluate(() => {
  const root = window as any;
  const frames = root.__ownerFrames ?? [];
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const stages: Record<string, number> = {};
  const names = new Set<string>(frames.flatMap((frame: any) => Object.keys(frame.timings)));
  for (const name of names) stages[name] = mean(frames.map((frame: any) => frame.timings[name] ?? 0));
  const passes: Record<string, { calls: number; triangles: number; ms: number }> = {};
  for (const frame of frames)
    for (const pass of frame.passes) {
      const name = `${pass.name}${pass.offscreen ? ":offscreen" : ""}`;
      const total = (passes[name] ??= { calls: 0, triangles: 0, ms: 0 });
      total.calls += pass.calls / frames.length;
      total.triangles += pass.triangles / frames.length;
      total.ms += pass.ms / frames.length;
    }
  return { frameCount: frames.length, passes, stages, stats: root.__ownerFrameStats.summarize() };
});

/** The hottest functions (self samples) of a CDP CPU profile taken for `milliseconds`. */
export const sampleHotFunctions = async (page: Page, milliseconds: number, count = 35) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  await page.waitForTimeout(milliseconds);
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.detach();
  const samples = new Map<number, number>();
  for (const id of profile.samples ?? []) samples.set(id, (samples.get(id) ?? 0) + 1);
  const hot = profile.nodes
    .map((node) => ({
      name: node.callFrame.functionName,
      url: node.callFrame.url,
      line: node.callFrame.lineNumber,
      samples: samples.get(node.id) ?? 0
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, count);
  return { hot, profile };
};

/**
 * Stages `save` (JSON text) in the startup slot, so the next game load continues it. `pinClock`
 * starts the page clock at the save time: no offline catch-up replaces the exact saved state.
 */
export const stageStartupSave = async (page: Page, url: string, save: string, pinClock = false) => {
  await page.route("**/stage-save.html", route => route.fulfill({ body: "<body>Staging save</body>",
    contentType: "text/html" }));
  if (pinClock) await page.addInitScript((savedAt) => {
    const realNow = Date.now, startedAt = realNow();
    Date.now = () => savedAt + realNow() - startedAt;
  }, (JSON.parse(save) as { savedAt: number }).savedAt);
  await page.goto(`${url}stage-save.html`);
  await page.evaluate(async (text) => {
    const module = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const storage = await module.openLocalSaveStore();
    await storage.writeStartupGame(text);
  }, save);
};

/** Enters the possessed eye view from the iso camera and lets it settle for four seconds. */
export const enterPossessedView = async (page: Page) => {
  await page.evaluate(() => (window as any).__exploration.controller.enter());
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null,
    { timeout: 60000 });
  await page.waitForTimeout(4000);
};
