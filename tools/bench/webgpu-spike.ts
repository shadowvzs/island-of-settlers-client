import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Page } from "playwright-core";

import { formatNumber, verdictOf } from "./ab-report";
import { compareSamples, median, quantileOfSorted } from "./ab-stats";
import { emitBenchJson } from "./bench-json";
import { launchBrowser, startDevServer } from "./browser";
import { summarizeCpuProfile } from "./cpu-profile-summary";
import { installRenderLoopProfiler, resetFrameProfile, sampleHotFunctions, stageStartupSave } from "./frame-profile";

/**
 * WG-0 measurement spike. Loads the real game scene, draws it through the configured renderer,
 * and records CPU submit (median/p95), GPU time, draw calls/triangles, first compile, JS heap and
 * the GPU memory estimate. `BENCH_JSON=1` emits one line per measurement for TOOL-4.
 *
 *   WEBGPU=1 <captures>/browser-slot.sh npx tsx tools/bench/webgpu-spike.ts
 *   SCENES=s1,s2 QUALITIES=high ROUNDS=3 FRAMES=20 ...
 *   PROFILE_MS=4000 also samples a CDP CPU profile per run (round 0) and writes
 *   `profile-<quality>-<scene>-<renderer>.json` (self and inclusive ms per function and module).
 *   S4 is the S1 town zoomed out to the iso overview (`S4_ZOOM`, default .4).
 *   SPIKE_QUERY adds page query parameters (e.g. `wgPropCasters=0`: a same-session A/B of a DEV switch).
 *
 * `webgpu` uses Chrome's software adapter on hosts without a native WebGPU adapter (this host);
 * `webgpu-gl` is the TSL node renderer on the real WebGL2 backend.
 */

type Renderer = "webgl" | "webgl-spike" | "webgpu" | "webgpu-gl";
type SceneKey = "s1" | "s2" | "s3" | "s4";

interface Measurement {
  adapter: string;
  lateBuilds: string[];
  /** G-W5: node builds / render pipelines created after the loading screen (steady state must be 0). */
  afterPrewarmNodeBuilds: number;
  afterPrewarmPipelines: number;
  /** G-W5: the worst of the first frames after the loading screen (whole renderer frame, ms). */
  firstFrameMaxMs: number;
  /** G-W5: the worst frame since the loading screen (live settle and measured frames). */
  worstFrameMs: number;
  /** G-W5 async compile: node builds made between frames, objects hidden until ready, longest hide. */
  asyncNodeBuilds: number;
  asyncCompiles: number;
  asyncBuilds: string[];
  maxHiddenFrames: number;
  maxHiddenMs: number;
  /** Not-yet-drawn objects the idle prewarm queued (their builds are in `asyncNodeBuilds`). */
  prewarmedObjects: number;
  calls: number;
  compileMs: number;
  cpuMedian: number;
  cpuP95: number;
  gpuMedian: number;
  heapBytes: number;
  loadMs: number;
  memoryBytes: number;
  mode: string;
  quality: string;
  renderer: Renderer;
  scene: SceneKey;
  substitutions: Record<string, number>;
  triangles: number;
}

const CAPTURES = process.env.CAPTURES ??
  "/media/shadowvzs/a3016bc8-b7d7-4116-b510-dad892792829/home/shadowvzs/worktree/captures";
const OWNER_SAVE = process.env.OWNER_SAVE ?? join(CAPTURES, "perf", "owner-laggy-2026-11-07.json");
const OUT = resolve(process.env.OUT ?? join(CAPTURES, "wg-0"));
const QUALITIES = (process.env.QUALITIES ?? "high,minimal").split(",");
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const FRAMES = Number(process.env.FRAMES ?? 24);
const SCENES = (process.env.SCENES ?? "s1,s2,s3").split(",") as SceneKey[];
const RENDERERS = (process.env.RENDERERS?.split(",") ?? ["webgl", "webgl-spike", "webgpu-gl", "webgpu"])
  .filter((value): value is Renderer => value === "webgl" || value === "webgl-spike" ||
    value === "webgpu-gl" || value === "webgpu");
const FRAME_TIMEOUT_MS = Number(process.env.FRAME_TIMEOUT_MS ?? 240_000);
const UNBATCHED = process.env.UNBATCHED === "1";
const PROFILE_MS = Number(process.env.PROFILE_MS ?? 0);
const S4_ZOOM = Number(process.env.S4_ZOOM ?? .4);
const BATTLE_SAVE = join(OUT, "battle-save.json");
mkdirSync(OUT, { recursive: true });

const waitFrames = (page: Page, frames: number) => page.evaluate(count => new Promise<void>(resolve => {
  let seen = 0;
  const tick = () => {
    seen++;
    if (seen >= count) resolve();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), frames);

const readNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const measurePage = async (page: Page, renderer: Renderer, scene: SceneKey,
  quality: string, loadMs: number): Promise<Measurement> => {
  await resetFrameProfile(page);
  await waitFrames(page, 2);
  await resetFrameProfile(page);
  await waitFrames(page, FRAMES);
  const raw = await page.evaluate(() => {
    const root = globalThis as any;
    const frames = root.__ownerFrames ?? [];
    const spike = root.__webgpuSpike?.stats?.() ?? null;
    const summary = root.__ownerFrameStats?.summarize?.() ?? null;
    const gpuTimes = root.__webgpuSpike?.frameTimings?.().gpu ?? [];
    return {
      compileMs: root.__rendererCompile?.ms ?? 0,
      frames: frames.map((frame: { timings?: { render?: number } }) => frame.timings?.render ?? 0),
      gpuTimes,
      heapBytes: (performance as any).memory?.usedJSHeapSize ?? 0,
      memoryBytes: spike?.memoryBytes ?? 0,
      spike,
      summary
    };
  });
  const cpu = raw.frames.filter((value: number) => value > 0).sort((a: number, b: number) => a - b);
  assert(cpu.length > 0, `${renderer}/${scene}: no frame CPU samples`);
  const webgl = renderer === "webgl" || renderer === "webgl-spike";
  const gpu: number[] = webgl ? [] : raw.gpuTimes;
  if (webgl && typeof raw.summary?.gpuMs === "number") gpu.push(raw.summary.gpuMs);
  const memoryBytes = webgl ? 0 : readNumber(raw.spike?.memoryBytes);
  return {
    adapter: webgl ? "webgl" : raw.spike?.adapter ?? "unknown",
    afterPrewarmNodeBuilds: readNumber(raw.spike?.pipelines?.afterPrewarm?.nodeBuilds),
    lateBuilds: raw.spike?.pipelines?.lateBuilds ?? [],
    afterPrewarmPipelines: readNumber(raw.spike?.pipelines?.afterPrewarm?.pipelines),
    firstFrameMaxMs: Math.max(0, ...(raw.spike?.pipelines?.firstFrameMs ?? [])),
    worstFrameMs: readNumber(raw.spike?.pipelines?.worstFrameMs),
    asyncNodeBuilds: readNumber(raw.spike?.pipelines?.async?.nodeBuilds),
    asyncCompiles: readNumber(raw.spike?.asyncCompile?.completed),
    asyncBuilds: raw.spike?.pipelines?.asyncBuilds ?? [],
    maxHiddenFrames: readNumber(raw.spike?.asyncCompile?.maxHiddenFrames),
    maxHiddenMs: readNumber(raw.spike?.asyncCompile?.maxHiddenMs),
    prewarmedObjects: readNumber(raw.spike?.asyncCompile?.prewarmed),
    calls: webgl ? readNumber(raw.summary?.drawCalls) : readNumber(raw.spike?.calls),
    compileMs: readNumber(raw.compileMs),
    cpuMedian: median(cpu),
    cpuP95: quantileOfSorted(cpu, .95),
    gpuMedian: gpu.length ? median(gpu) : 0,
    heapBytes: readNumber(raw.heapBytes),
    loadMs,
    memoryBytes,
    mode: webgl ? "webgl" : raw.spike?.mode ?? "webgl",
    quality,
    renderer,
    scene,
    substitutions: webgl ? {} : raw.spike?.substitutions ?? {},
    triangles: webgl ? readNumber(raw.summary?.triangles) : readNumber(raw.spike?.triangles)
  };
};

/** A sampled CPU profile of the settled scene: the hottest functions and the costliest modules. */
const writeCpuProfile = async (page: Page, name: string) => {
  const { profile } = await sampleHotFunctions(page, PROFILE_MS);
  const summary = summarizeCpuProfile(profile, PROFILE_MS);
  writeFileSync(join(OUT, `profile-${name}.json`), JSON.stringify(summary, null, 2));
};

const freezeSimulation = (page: Page) => page.evaluate(() => {
  const simulation = (globalThis as any).__settlement?.simulation;
  if (!simulation) return;
  simulation.__wg0Update ??= simulation.update;
  simulation.update = () => undefined;
});

const openScene = async (page: Page, url: string, renderer: Renderer, quality: string, scene: SceneKey,
  saveText: string | null, passProfile = false) => {
  if (UNBATCHED) await page.addInitScript(() => { (globalThis as any).__probeNoBuildingBatch = true; });
  if (saveText !== null) await stageStartupSave(page, url, saveText, true);
  const startedAt = performance.now();
  const appRenderer = renderer === "webgl-spike" ? "webgl" : renderer;
  const params = new URLSearchParams({ cache: "0", quality, renderer: appRenderer, skipLogin: "1" });
  if (renderer === "webgl-spike") params.set("wg0", "nooffscreen");
  if (passProfile) params.set("passes", "1");
  if (scene === "s1" || scene === "s4") params.set("view", process.env.S1_VIEW ?? "170,38,0.85");
  if (scene === "s2") {
    params.set("reveal", "1");
    params.set("seed", "123");
    params.set("size", "128");
    params.set("view", "100,52,2.2");
  }
  if (scene === "s3") params.set("view", "46,48,1");
  for (const [key, value] of new URLSearchParams(process.env.SPIKE_QUERY ?? "")) params.set(key, value);
  await page.goto(`${url}?${params}`);
  await page.waitForFunction(() => (globalThis as any).__islandReady === true, null, { timeout: FRAME_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: FRAME_TIMEOUT_MS });
  await page.evaluate(() => (globalThis as any).__webgpuSpike?.finishPrewarm?.());
  const loadMs = performance.now() - startedAt;
  if (scene === "s2") {
    await page.evaluate(() => (globalThis as any).__exploration.controller.enter());
    await page.waitForFunction(() => (globalThis as any).__exploration.controller.phase() === "possessed",
      null, { timeout: 120_000 });
  }
  if (scene === "s1" || scene === "s4") await page.evaluate(zoom =>
    (globalThis as any).__settlement?.focusGround?.(170, 68, zoom), scene === "s4" ? S4_ZOOM : .75);
  await page.waitForTimeout(2000);
  await freezeSimulation(page);
  await page.evaluate(() => (globalThis as any).__webgpuSpike?.settle?.());
  await page.waitForTimeout(500);
  return loadMs;
};

/** The WebGL ledger is installed by `?passes=1`; read it after the scene settled. */
const measureWebGlMemory = async (page: Page, url: string, quality: string, scene: SceneKey,
  saveText: string | null) => {
  await openScene(page, url, "webgl-spike", quality, scene, saveText, true);
  return page.evaluate(async () => {
    const path = "/src/render-common/gpu-memory-ledger.ts";
    const module = await import(/* @vite-ignore */ path);
    const canvas = document.getElementById("view") as HTMLCanvasElement;
    const report = module.readGpuMemory(canvas.getContext("webgl2")!);
    if (!report) return 0;
    return report.bufferBytes + report.renderbufferBytes + report.targetTextureBytes + report.textureBytes;
  });
};

const battleSaveText = async (page: Page, url: string) => {
  await page.routeWebSocket("**/*", () => undefined);
  await page.addInitScript(() => { (globalThis as any).__name = (value: unknown) => value; });
  await page.route("**/stage-save.html", route => route.fulfill({
    body: "<body>Staging battle</body>", contentType: "text/html"
  }));
  await page.goto(`${url}stage-save.html`);
  const text = await page.evaluate(async () => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const { DEFAULT_WORLD_OPTIONS, generateWorld } =
      await imp("/src/shared/world/generation/generate-world.ts");
    const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
    const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
    const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
    const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 96, cellsZ: 96,
      erosionDroplets: 100, seed: 7 });
    world.heights.fill(1);
    world.blocking.fill(0);
    world.walkCost.fill(10);
    world.buildClass.fill(4);
    world.buildCap.fill(4);
    world.slopeClass.fill(0);
    world.start = { x: 30.5, z: 48.5 };
    world.props.count = 0;
    let simulation: any;
    const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) });
    simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, initialSettlers: 2,
      initialStock: { planks: 80, stone: 80 }, roads, world });
    const troopTypes = ["shield", "heavy", "archer"] as const;
    simulation.receiveTroops(Array.from({ length: 64 }, (_, index) =>
      ({ hp: troopTypes[index % 3] === "archer" ? 56 : 125, rank: 0, type: troopTypes[index % 3] })));
    if (!simulation.plantMilitaryRally({ x: 30, z: 48 })) throw new Error("rally");
    simulation.callOutMilitary([...troopTypes], { x: 30, z: 48 });
    for (let second = 0; second < 120; second++) simulation.update(1);
    const enemy = troopTypes.flatMap((type, typeIndex) => Array.from({ length: 22 }, (_, index) => {
      const slot = typeIndex * 22 + index;
      return simulation.spawnMilitaryOpponent({ x: 62 + (slot % 8) * .8 - 3.2,
        z: 48 + Math.floor(slot / 8) * .8 - 3.2 }, type, 0, 1);
    })).filter((id: number | null): id is number => id !== null);
    if (enemy.length < 60) throw new Error(`only ${enemy.length} enemies spawned`);
    simulation.commandMilitaryOpponent(enemy, { x: 30, z: 48 }, 1, "attackMove");
    const ours = simulation.militarySoldiers().filter((soldier: any) => (soldier.combat?.faction ?? 0) === 0)
      .map((soldier: any) => soldier.actor);
    simulation.commandMilitary(ours, { x: 62, z: 48 }, "attackMove");
    for (let second = 0; second < 24; second++) simulation.update(1);
    const save = await createGameSave(world, simulation.saveState(), { animals: [], name: "WebGPU battle",
      savedAt: Date.now(), source: "generated" });
    return JSON.stringify(save);
  });
  writeFileSync(BATTLE_SAVE, text);
  return text;
};

const sceneSave = (scene: SceneKey, ownerSave: string, battleSave: string | null) => {
  if (scene === "s1" || scene === "s4") return ownerSave;
  if (scene === "s3") return battleSave;
  return null;
};

const metricNames = ["cpuMedian", "cpuP95", "gpuMedian", "calls", "triangles", "compileMs", "loadMs", "memoryBytes",
  "heapBytes", "firstFrameMaxMs", "worstFrameMs", "afterPrewarmNodeBuilds", "afterPrewarmPipelines",
  "asyncNodeBuilds", "asyncCompiles", "prewarmedObjects", "maxHiddenFrames", "maxHiddenMs"] as const;

const writeReport = (results: readonly Measurement[]) => {
  const lines = ["# WG-0 renderer spike", "",
    "The same-pass baseline draws the WebGL scene without its offscreen shadow/refraction/post passes, matching the",
    "unported WebGPU path's on-screen draws. The full WebGL column is the ordinary renderer.", "",
    "| Quality | Scene | Metric | WebGL full | WebGL same-pass | webgpu-gl | webgpu | " +
      "Δ webgpu-gl | Δ webgpu |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const quality of QUALITIES) for (const scene of SCENES) {
    const rows = results.filter(result => result.quality === quality && result.scene === scene);
    const of = (renderer: Renderer) => rows.filter(result => result.renderer === renderer);
    const full = of("webgl");
    const base = of("webgl-spike");
    const gl = of("webgpu-gl");
    const gpu = of("webgpu");
    for (const metric of metricNames) {
      const values = (items: readonly Measurement[]) => items.map(item => item[metric]);
      const compareGl = compareSamples(values(base), values(gl));
      const compareGpu = compareSamples(values(base), values(gpu));
      lines.push(`| ${quality} | ${scene} | ${metric} | ${formatNumber(median(values(full)))} | ` +
        `${formatNumber(compareGl.base.median)} | ${formatNumber(compareGl.lane.median)} | ` +
        `${formatNumber(compareGpu.lane.median)} | ` +
        `${verdictOf(compareGl)} (±${formatNumber(compareGl.noiseBand)}) | ` +
        `${verdictOf(compareGpu)} (±${formatNumber(compareGpu.noiseBand)}) |`);
    }
  }
  const markdown = `${lines.join("\n")}\n`;
  writeFileSync(join(OUT, "report.md"), markdown);
  console.log(markdown);
};

const main = async () => {
  const ownerSave = readFileSync(OWNER_SAVE, "utf8");
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const results: Measurement[] = [];
  const errors: string[] = [];
  const persist = () => writeFileSync(join(OUT, "measurements.json"), JSON.stringify({ errors,
    generatedAt: new Date().toISOString(), quality: QUALITIES, results, rounds: ROUNDS }, null, 2));
  try {
    let battleSave: string | null = null;
    if (SCENES.includes("s3")) {
      const page = await browser.newPage();
      page.on("pageerror", error => errors.push(`battle fixture: ${error.message}`));
      battleSave = await battleSaveText(page, url);
      await page.close();
    }
    for (const quality of QUALITIES) for (const scene of SCENES) {
      const saveText = sceneSave(scene, ownerSave, battleSave);
      for (let round = 0; round < ROUNDS; round++) {
        const baseOrder = round === 0 ? RENDERERS : RENDERERS.filter(renderer => renderer !== "webgl");
        const order = round % 2 === 0 ? baseOrder : [...baseOrder].reverse();
        for (const renderer of order) {
          const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
          page.on("pageerror", error => errors.push(`${renderer}/${scene}: ${error.message}`));
          page.on("console", message => {
            if (message.type() !== "error" && message.type() !== "warning") return;
            appendFileSync(join(OUT, "console.log"),
              `${renderer}/${scene} ${message.type()}: ${message.text()}\n`);
          });
          await page.routeWebSocket("**/*", () => undefined);
          await page.addInitScript(() => { (globalThis as any).__name = (value: unknown) => value; });
          await installRenderLoopProfiler(page);
          try {
            const loadMs = await openScene(page, url, renderer, quality, scene, saveText);
            const measured = await measurePage(page, renderer, scene, quality, loadMs);
            results.push(measured);
            persist();
            emitBenchJson({ [`${quality}.${scene}.${renderer}`]: measured });
            console.log(`${quality} ${scene} ${renderer} round ${round}: cpu ${measured.cpuMedian.toFixed(2)} ms ` +
              `p95 ${measured.cpuP95.toFixed(2)}, gpu ${measured.gpuMedian.toFixed(2)}, ` +
              `calls ${measured.calls}, compile ${measured.compileMs.toFixed(0)}, adapter ${measured.adapter}, ` +
              `first frame ${measured.firstFrameMaxMs.toFixed(1)} ms, late builds ${measured.afterPrewarmNodeBuilds}` +
              `/${measured.afterPrewarmPipelines}, worst frame ${measured.worstFrameMs.toFixed(1)} ms, ` +
              `async ${measured.asyncCompiles} + prewarm ${measured.prewarmedObjects} ` +
              `(${measured.asyncNodeBuilds} builds, hidden max ` +
              `${measured.maxHiddenFrames} frames/${measured.maxHiddenMs.toFixed(0)} ms)`);
            if (round === 0) await page.screenshot({ path: join(OUT, `${quality}-${scene}-${renderer}.png`) });
            if (round === 0 && PROFILE_MS > 0) await writeCpuProfile(page, `${quality}-${scene}-${renderer}`);
          } finally {
            await page.close();
          }
        }
      }
      const memoryPage = await browser.newPage({ viewport: { height: 900, width: 1400 } });
      memoryPage.on("pageerror", error => errors.push(`memory/${scene}: ${error.message}`));
      await memoryPage.routeWebSocket("**/*", () => undefined);
      await memoryPage.addInitScript(() => { (globalThis as any).__name = (value: unknown) => value; });
      try {
        const memoryBytes = await measureWebGlMemory(memoryPage, url, quality, scene, saveText);
        for (const result of results)
          if (result.quality === quality && result.scene === scene && result.renderer === "webgl-spike")
            result.memoryBytes = memoryBytes;
        console.log(`${quality} ${scene} WebGL same-pass GPU memory ${(memoryBytes / 1024 / 1024).toFixed(1)} MiB`);
      } finally {
        await memoryPage.close();
      }
    }
    const substitutions: Record<string, number> = {};
    for (const result of results) for (const [type, count] of Object.entries(result.substitutions))
      substitutions[type] = Math.max(substitutions[type] ?? 0, count);
    writeFileSync(join(OUT, "substitutions.json"), JSON.stringify(substitutions, null, 2));
    writeFileSync(join(OUT, "measurements.json"), JSON.stringify({ errors, generatedAt: new Date().toISOString(),
      quality: QUALITIES, results, rounds: ROUNDS, substitutions }, null, 2));
    writeReport(results);
    console.log(`Wrote ${join(OUT, "measurements.json")}`);
    if (errors.length) console.warn(`Page errors:\n${errors.join("\n")}`);
    assert.equal(errors.length, 0, "page errors");
  } finally {
    await browser.close();
    await server.close();
  }
};

main().catch(error => {
  console.error((error as Error).stack ?? error);
  process.exitCode = 1;
});
