import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { closeDevelopment, openDevelopmentAction } from "./development-ui-helpers";
import {
  installFrameProfiler, readFrameProfile, resetFrameProfile, sampleHotFunctions, stageStartupSave
} from "./frame-profile";
import { resourcesPath } from "./resources-path";

const input = "/home/shadowvzs/Downloads/island-settlers-2026-11-04.json";
const bytes = readFileSync(input);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const originalHash = hash(bytes);
const label = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "before";
const requestedQuality = process.argv.find(argument => argument.startsWith("--quality="))?.slice(10);
const qualities = (requestedQuality ?? process.env.QUALITIES ?? "minimal,high").split(",");
const outdoorBaseline = process.argv.includes("--outdoor-baseline");
const dockSeaBaseline = process.argv.includes("--dock-sea-baseline");
const countSeaMasks = process.argv.includes("--count-sea-masks");
const buildAllSampleMs = Number(process.argv.find(argument => argument.startsWith("--build-all-ms="))?.slice(15) ?? 7000);
assert(Number.isFinite(buildAllSampleMs) && buildAllSampleMs >= 1000 && buildAllSampleMs <= 20000);
const output = resourcesPath("project-reviews", "build-all-slowdown-2026-11-04", "browser", label);
mkdirSync(output, { recursive: true });
const sourceFiles = ["src/app/render-loop.ts", "src/renderers/three/create-three-renderer.ts",
  "src/shared/settlement/settlement-simulation.ts", "src/shared/settlement/settlement-debug-build-all.ts",
  "src/app/settlement/debug-build-all-runner.ts", "src/shared/settlement/settlement-navigation.ts",
  "src/shared/settlement/settlement-logistics.ts",
  "src/shared/settlement/settlement-building-navigation.ts",
  "src/shared/settlement/settlement-carrier-road-recovery.ts",
  "src/shared/settlement/settlement-carrier-home.ts",
  "src/shared/settlement/settlement-road-rerouting.ts",
  "src/shared/settlement/settlement-paths.ts",
  "src/shared/settlement/settlement-terrain-routing.ts",
  "src/shared/settlement/settlement-worker-stock-paths.ts",
  "src/shared/settlement/military-routing.ts",
  "src/shared/settlement/military-long-routes.ts",
  "src/shared/settlement/building-navigation-corridor.ts",
  "src/shared/settlement/harbour-boat-route.ts",
  "src/shared/settlement/harbour-boat-jetty.ts",
  "src/shared/settlement/settlement-foundation-changes.ts",
  "src/shared/settlement/settlement-sea-navigation.ts",
  "src/shared/settlement/settlement-harbour-docks.ts",
  "src/shared/settlement/road-ground-leveling.ts",
  "src/render-common/buildings/building-navigation-geometry.ts",
  "src/render-common/buildings/building-navigation-profile.ts"];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(resolve(file)))]));
const startHashes = sourceHashes();
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const rows: unknown[] = [];
let status = "failed";
try {
  for (const quality of qualities) {
    const context = await browser.newContext({ viewport: { height: 900, width: 1400 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors: string[] = [];
    const importedSources: Record<string, string> = {};
    const sourceReads: Promise<void>[] = [];
    page.on("response", response => {
      if (!response.url().includes("/src/") || !response.ok()) return;
      sourceReads.push(response.body().then(body => {
        importedSources[new URL(response.url()).pathname] = hash(body);
        return undefined;
      }).catch(() => {}));
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") console.log(`[browser:${quality}] ${message.text()}`);
    });
    await page.routeWebSocket("**/*", () => {});
    await page.addInitScript(quality => {
      const root = window as any;
      root.__name = (value: unknown) => value;
      root.__saveStageProfile = true;
      root.__buildAllLongTasks = [];
      new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) root.__buildAllLongTasks.push({
          duration: entry.duration, startTime: entry.startTime
        });
      }).observe({ entryTypes: ["longtask"] });
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
      localStorage.setItem("island-of-settlers.sound", "0");
    }, quality);
    await stageStartupSave(page, url, bytes.toString("utf8"), true);
    let baselineApplied = false;
    let dockBaselineApplied = false;
    let dockBaselineOverride: { diskResponseHash: string; servedResponseHash: string } | undefined;
    if (dockSeaBaseline) await page.route("**/src/shared/settlement/settlement-harbour-docks.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const declaration = "const sea = currentSea ?? defaultSeaFor(context);";
      const guard = " || cache.sea !== sea";
      const cache = /(\bcache\s*=\s*\{[^;]+?\brevision,\s*)sea(\s*\})/g;
      assert.equal(source.split(declaration).length, 2); assert.equal(source.split(guard).length, 2);
      assert.equal([...source.matchAll(cache)].length, 1);
      const body = source.replace(declaration, "").replace(guard, "")
        .replace(cache, "$1sea: currentSea ?? createSeaMask(world)$2");
      dockBaselineApplied = true;
      dockBaselineOverride = { diskResponseHash: hash(source), servedResponseHash: hash(body) };
      await route.fulfill({ response, body });
    });
    if (countSeaMasks) await page.route("**/src/shared/settlement/settlement-sea-navigation.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const call = 'profileNavigationStage("sea.mask", () => createSeaMaskImpl(world))';
      assert.equal(source.split(call).length, 2);
      const body = source.replace(call, 'profileNavigationStage("sea.mask", () => { globalThis.__ownerSeaMaskBuilds = (globalThis.__ownerSeaMaskBuilds ?? 0) + 1; return createSeaMaskImpl(world); })');
      await route.fulfill({ response, body });
    });
    let baselineOverride: { url: string; diskResponseHash: string; servedResponseHash: string } | undefined;
    if (outdoorBaseline) await page.route("**/src/shared/settlement/settlement-worker-stock-paths.ts*", async route => {
      const response = await route.fetch(), source = await response.text();
      const declaration = /const longPublicLeg = [^;]+;/g;
      assert.equal([...source.matchAll(declaration)].length, 1, "Expected the exact outdoor routing decision");
      baselineApplied = true;
      const body = source.replace(declaration, "const longPublicLeg = false;");
      baselineOverride = { url: route.request().url(), diskResponseHash: hash(source), servedResponseHash: hash(body) };
      await route.fulfill({ response, body });
    });
    await installFrameProfiler(page, source => source.replace("const gl = renderer.getContext();",
      "window.__ownerResources = () => ({ geometries: renderer.info.memory.geometries, " +
      "textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 }); " +
      "const gl = renderer.getContext(); " +
      "const debugRenderer = gl.getExtension('WEBGL_debug_renderer_info'); " +
      "window.__ownerGpuInfo = () => ({ renderer: debugRenderer " +
      "? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), " +
      "drawingBufferWidth: gl.drawingBufferWidth, drawingBufferHeight: gl.drawingBufferHeight });"));
    await page.route("**/src/app/island-settlement-boot.ts*", async route => {
      const response = await route.fetch();
      const source = await response.text();
      assert.ok(source.includes("devHooks.captureReplayBaseline = captureIsland;"));
      await route.fulfill({ response, body: source.replace("devHooks.captureReplayBaseline = captureIsland;",
        "devHooks.captureReplayBaseline = captureIsland; window.__ownerCapture = captureIsland;") });
    });
    console.log(JSON.stringify({ phase: "boot", quality, inputHash: originalHash, run: label }));
    await page.goto(`${url}admin.html?skipLogin=1&cache=0&profile=1`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement),
      null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180000 });
    console.log(JSON.stringify({ phase: "ready", quality }));
    const snapshot = () => page.evaluate(async () => {
      const root = window as any, simulation = root.__settlement.simulation;
      const state = simulation.saveState();
      return { actors: state.actors.length, buildings: state.buildings.length,
        gameTick: state.gameTick, nation: simulation.playerNation(), stats: root.__ownerStats,
        actorUids: state.actors.map((actor: any) => actor.uid), buildingUids: state.buildings.map((building: any) => building.uid),
        actor11: state.actors.find((actor: any) => actor.uid === 11),
        blocked: state.actors.filter((actor: any) => actor.lastMoveOutcome === "static-blocked")
          .map((actor: any) => ({ id: actor.uid, phase: actor.phase, cargo: actor.ware })),
        saveStages: root.__saveStageProfileRead?.() ?? [], longTasks: root.__buildAllLongTasks,
        gpu: root.__ownerGpuInfo?.() ?? null,
        seaMaskBuilds: root.__ownerSeaMaskBuilds ?? null,
        resources: root.__ownerResources?.() ?? null };
    });
    await page.waitForTimeout(2000);
    const initial = await snapshot();
    await resetFrameProfile(page);
    await page.evaluate(() => {
      (window as any).__buildAllLongTasks = [];
      (window as any).__saveStageProfileClear?.();
    });
    await page.waitForTimeout(7000);
    const ordinary = await readFrameProfile(page);
    const beforeSampling = await snapshot();
    await resetFrameProfile(page);
    const { hot, profile } = await sampleHotFunctions(page, 7000, 45);
    const sampled = await readFrameProfile(page);
    const afterSampling = await snapshot();
    console.log(JSON.stringify({ phase: "ordinary-sampled", quality, stats: sampled.stats }));
    let buildAll: unknown;
    if (process.argv.includes("--build-all")) {
      const action = await openDevelopmentAction(page, "Build every building");
      const residual = process.argv.includes("--residual");
      const cdp = residual ? await page.context().newCDPSession(page) : null;
      if (cdp) {
        await page.evaluate(async () => {
          const root = window as any;
          await root.__settlement.bugReplay.start(root.__ownerCapture);
        });
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
        await cdp.send("Profiler.start");
      }
      await resetFrameProfile(page);
      if (countSeaMasks) await page.evaluate(() => { (window as any).__ownerSeaMaskBuilds = 0; });
      const started = Date.now();
      console.log(JSON.stringify({ phase: "build-all-start", quality }));
      await action.click();
      await closeDevelopment(page);
      await page.waitForTimeout(buildAllSampleMs);
      buildAll = { sampleMs: buildAllSampleMs, wallMs: Date.now() - started, snapshot: await snapshot(), frames: await readFrameProfile(page) };
      if (cdp) {
        const { profile: residualProfile } = await cdp.send("Profiler.stop");
        await cdp.detach();
        const samples = new Map<number, number>();
        for (const id of residualProfile.samples ?? []) samples.set(id, (samples.get(id) ?? 0) + 1);
        const residualHot = residualProfile.nodes.map(node => ({ ...node.callFrame,
          samples: samples.get(node.id) ?? 0 })).sort((a, b) => b.samples - a.samples).slice(0, 60);
        writeFileSync(resolve(output, `${quality}-build-all.cpuprofile`), JSON.stringify(residualProfile));
        writeFileSync(resolve(output, `${quality}-build-all-hot.json`), JSON.stringify(residualHot, null, 2));
        const captured = await page.evaluate(async () => {
          const root = window as any;
          return { save: await root.__ownerCapture(), reproduction: root.__settlement.bugReplay.report(),
            settlement: root.__settlement.simulation.saveState() };
        });
        for (const [name, value] of Object.entries(captured))
          writeFileSync(resolve(output, `${quality}-build-all-${name}.json`), JSON.stringify(value));
        console.log(JSON.stringify({ phase: "residual-captured", quality, output, hot: residualHot.slice(0, 12) }));
      }
    }
    await page.screenshot({ path: resolve(output, `${quality}.png`), timeout: 60000 });
    await Promise.all(sourceReads);
    assert.equal(baselineApplied, outdoorBaseline);
    assert.equal(dockBaselineApplied, dockSeaBaseline);
    const result = { quality, inputHash: originalHash, outdoorBaseline, baselineApplied, baselineOverride,
      dockSeaBaseline, dockBaselineApplied, dockBaselineOverride, countSeaMasks, initial, ordinary, beforeSampling,
      sampled, afterSampling, buildAll, hot, errors, importedSources };
    writeFileSync(resolve(output, `${quality}.json`), JSON.stringify(result, null, 2));
    writeFileSync(resolve(output, `${quality}.cpuprofile`), JSON.stringify(profile));
    rows.push(result);
    console.log(JSON.stringify({ phase: "measured", quality, ordinary, hot: hot.slice(0, 18), errors }));
    assert.deepEqual(errors, []);
    await context.close();
  }
  assert.equal(hash(readFileSync(input)), originalHash, "The original owner save is immutable");
  assert.deepEqual(sourceHashes(), startHashes, "Profiled navigation source changed during capture");
  status = "passed";
} finally {
  await browser.close();
  await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, input, originalHash,
    sourceHashesBefore: startHashes, sourceHashesAfter: sourceHashes(), rows }, null, 2));
}
