import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { ADAPTIVE_PERFORMANCE_KEY } from "../../src/app/render-budget/constants";
import { launchBrowser, startDevServer } from "./browser";
import { installFrameProfiler, sampleHotFunctions, stageStartupSave } from "./frame-profile";

/**
 * ZOOM-VEG: frame cost of strategy-camera zoom changes on the live owner save (read only). Every rAF
 * records its interval, the loop CPU, the vegetation update, the world / shadow pass and the WebGL
 * buffer uploads (bufferSubData / bufferData bytes and ms) of that frame. Phases:
 * - still: no camera change (baseline);
 * - steps: single zoom steps alternating between each pair of STEP_PAIRS;
 * - sweep: continuous wheel-like zoom (factor per frame) from SWEEP_MIN to 3 and back, SWEEPS times.
 *
 *   OWNER_SAVE=<save.json> OUTPUT_DIR=<dir> [QUALITIES=high,minimal] [REPORT_TAG=run] [UNCAPPED=1]
 *   [STEP_PAIRS=1.6:1.8,1.49:1.51] [STEP_CYCLES=4] [HOLD_MS=1200] [SWEEPS=2] [SWEEP_MIN=0.6]
 *   [SWEEP_FACTOR=1.02] [PROFILE=1] (CPU profile of one step pair)
 *   [FIRST_ZOOM_RUNS=5] (instead: fresh loads, first far zoom after the impostor bake; FIRST_ZOOM_WAIT_MS,
 *   FIRST_ZOOMS=0.6,0.4, FIRST_ZOOM_QUALITY=high, TRACE_STEP=<index>)
 *   npx tsx tools/bench/zoom-veg-hitch.ts
 */
const sourcePath = process.env.OWNER_SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set OWNER_SAVE and OUTPUT_DIR");
const saveText = readFileSync(sourcePath, "utf8");
const tag = process.env.REPORT_TAG ?? "run";
const holdMs = Number(process.env.HOLD_MS ?? 1200);
const stepCycles = Number(process.env.STEP_CYCLES ?? 4);
const stepPairs = (process.env.STEP_PAIRS ?? "0.6:0.7,1.0:1.2,1.49:1.51,1.6:1.8,2.2:2.5,2.8:3")
  .split(",").map(pair => pair.split(":").map(Number) as [number, number]);
const sweep = { factor: Number(process.env.SWEEP_FACTOR ?? 1.02), min: Number(process.env.SWEEP_MIN ?? 0.6),
  times: Number(process.env.SWEEPS ?? 2) };
mkdirSync(outputDir, { recursive: true });

type Sample = { at: number; bakeReady: boolean; bufBytes: number; bufCalls: number; bufMs: number; compileMs: number;
  cpu: number; dt: number; programs: number; shadows: number; texMs: number; vegetation: number; world: number };
type SampleValue = Exclude<keyof Sample, "at" | "bakeReady">;

/** Wraps the WebGL2 upload calls: bytes, calls and blocking ms accumulate until the recorder reads them. */
const installUploadCounter = (page: Page) => page.addInitScript(() => {
  const root = window as any;
  root.__zvUpload = { bytes: 0, calls: 0, compileMs: 0, ms: 0, texMs: 0 };
  const proto = WebGL2RenderingContext.prototype as any;
  /** Bytes sent: an explicit element length (bufferSubData srcOffset/length) or the whole view. */
  const bytesOf = (data: any, srcOffset = 0, length?: number) => {
    if (typeof data !== "object" || !data) return 0;
    const element = data.BYTES_PER_ELEMENT ?? 1;
    return length ? length * element : data.byteLength - srcOffset * element;
  };
  for (const [name, dataArg] of [["bufferSubData", 2], ["bufferData", 1]] as const) {
    const original = proto[name];
    proto[name] = function (...args: any[]) {
      const start = performance.now();
      const result = original.apply(this, args);
      const counter = root.__zvUpload;
      counter.ms += performance.now() - start;
      counter.calls += 1;
      counter.bytes += name === "bufferSubData" ? bytesOf(args[2], args[3], args[4]) : bytesOf(args[dataArg]);
      return result;
    };
  }
  /** Texture uploads and the program calls that can block on a compile, timed separately. */
  const timeCalls = (names: string[], key: "compileMs" | "texMs") => {
    for (const name of names) {
      const original = proto[name];
      proto[name] = function (...args: any[]) {
        const start = performance.now();
        const result = original.apply(this, args);
        root.__zvUpload[key] += performance.now() - start;
        return result;
      };
    }
  };
  timeCalls(["texImage2D", "texSubImage2D", "texImage3D", "texSubImage3D", "generateMipmap"], "texMs");
  /** Large texture storage (the impostor atlases): when it is allocated, and its size. */
  root.__zvAtlases = [];
  const texStorage2D = proto.texStorage2D;
  proto.texStorage2D = function (...args: any[]) {
    if (args[3] >= 1024) root.__zvAtlases.push({ at: performance.now(), height: args[4], levels: args[1], width: args[3] });
    return texStorage2D.apply(this, args);
  };
  timeCalls(["compileShader", "linkProgram", "getProgramParameter", "getShaderParameter"], "compileMs");
  /**
   * A program's first use (three's uniform/attribute reflection) is a synchronous round trip to the GPU
   * process: it waits for every command queued before it. Logged per GL program with its blocking ms.
   */
  root.__zvFirstUse = [];
  const reflected = new WeakSet<object>();
  for (const name of ["getActiveUniform", "getActiveAttrib", "getUniformLocation", "getAttribLocation"]) {
    const original = proto[name];
    proto[name] = function (program: object, ...args: any[]) {
      const start = performance.now();
      const result = original.call(this, program, ...args);
      const ms = performance.now() - start;
      root.__zvUpload.compileMs += ms;
      if (!reflected.has(program)) {
        reflected.add(program);
        root.__zvFirstUse.push({ at: performance.now(), ms, program });
      } else root.__zvFirstUse.at(-1).ms += ms;
      return result;
    };
  }
});

/** First uses (program reflection) after `since`: three program id, blocking ms and owners. */
const firstUsesSince = async (page: Page, since: number) => {
  const uses = await page.evaluate(after => {
    const root = window as any;
    const programs = root.__zv.renderer.info.programs ?? [];
    return (root.__zvFirstUse as any[]).filter(use => use.at >= after).map(use => {
      const program = programs.find((item: any) => item.program === use.program);
      return { at: use.at, id: program?.id ?? -1, key: String(program?.cacheKey ?? "").length,
        ms: Number(use.ms.toFixed(1)) };
    });
  }, since);
  const labels = await programOwners(page, uses.map(use => `#${use.key}:${use.id}`));
  return uses.map((use, index) => ({ ...use, owner: labels[index]!.slice(0, 160) }));
};

const startRecorder = (page: Page) => page.evaluate(() => {
  const root = window as any;
  root.__zvSamples = [];
  root.__zvMarks = [];
  root.__zvUpload = { bytes: 0, calls: 0, compileMs: 0, ms: 0, texMs: 0 };
  let last = performance.now();
  const passMs = (name: string) => ((root.__ownerPasses ?? []) as any[])
    .filter(pass => pass.name === name).reduce((sum, pass) => sum + pass.ms, 0);
  const tick = (now: number) => {
    const timings = root.__ownerTimings ?? {};
    const upload = root.__zvUpload;
    root.__zvSamples.push({ at: now, bakeReady: root.__zvImpostorsAt !== undefined, bufBytes: upload.bytes, bufCalls: upload.calls, bufMs: upload.ms,
      compileMs: upload.compileMs, cpu: timings.cpu ?? 0, dt: now - last,
      programs: root.__zv.renderer.info.programs?.length ?? 0, shadows: passMs("shadows"), texMs: upload.texMs,
      vegetation: timings.vegetation ?? 0, world: passMs("world") });
    root.__zvUpload = { bytes: 0, calls: 0, compileMs: 0, ms: 0, texMs: 0 };
    last = now;
    if (root.__zvRecording) requestAnimationFrame(tick);
  };
  root.__zvRecording = true;
  requestAnimationFrame(tick);
});

const stopRecorder = (page: Page) => page.evaluate(() => {
  const root = window as any;
  root.__zvRecording = false;
  return { marks: root.__zvMarks as number[], samples: root.__zvSamples as Sample[] };
});

/** Sets the zoom and marks the next recorded frame as the first one after a change. */
const setZoom = (page: Page, zoom: number) => page.evaluate(value => {
  const root = window as any;
  root.__ownerCamera.zoom = value;
  root.__zvMarks?.push(root.__zvSamples?.length ?? 0);
}, zoom);

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

/** Frames after a zoom change that still carry its work (the upload lands on the next draw). */
const CHANGE_WINDOW = 4;

/**
 * Worst interval in the frames after each change; for the still phase (no marks) the same window at
 * every 20th frame, which gives the background noise to compare against.
 */
const changeWindows = (samples: Sample[], marks: number[]) => {
  const starts = marks.length ? marks : samples.map((_, index) => index).filter(index => index % 20 === 2);
  return starts.map(start => Math.max(0, ...samples.slice(start, start + CHANGE_WINDOW).map(sample => sample.dt)));
};

const summarize = (samples: Sample[], marks: number[]) => {
  const all = samples.slice(2);
  const windows = changeWindows(samples, marks);
  const pick = (key: SampleValue) => all.map(sample => sample[key]);
  const round = (value: number) => Number(value.toFixed(1));
  return {
    changes: windows.length, changeWorstMedian: round(percentile(windows, .5)),
    changeWorstP90: round(percentile(windows, .9)),
    worstVegetationUpload: round(Math.max(...all.map(sample => sample.vegetation + sample.bufMs))),
    frames: all.length, over33: all.filter(sample => sample.dt > 33).length,
    p50Dt: round(percentile(pick("dt"), .5)), p99Dt: round(percentile(pick("dt"), .99)),
    worstDt: round(Math.max(...pick("dt"))), worstCpu: round(Math.max(...pick("cpu"))),
    worstVegetation: round(Math.max(...pick("vegetation"))), worstWorld: round(Math.max(...pick("world"))),
    worstShadows: round(Math.max(...pick("shadows"))), worstCompileMs: round(Math.max(...pick("compileMs"))),
    worstTexMs: round(Math.max(...pick("texMs"))), worstUploadMs: round(Math.max(...pick("bufMs"))),
    worstUploadMiB: round(Math.max(...pick("bufBytes")) / 2 ** 20),
    totalUploadMiB: round(pick("bufBytes").reduce((a, b) => a + b, 0) / 2 ** 20)
  };
};

const record = async (page: Page, run: () => Promise<void>) => {
  await startRecorder(page);
  await run();
  const { marks, samples } = await stopRecorder(page);
  return { marks, samples, summary: summarize(samples, marks) };
};

/** The jump from the previous zoom to `low` is recorded too (one large single step). */
const stepPhase = (page: Page, [low, high]: [number, number]) => record(page, async () => {
  await setZoom(page, low);
  await page.waitForTimeout(holdMs * 2);
  for (let cycle = 0; cycle < stepCycles; cycle++) {
    await setZoom(page, high);
    await page.waitForTimeout(holdMs);
    await setZoom(page, low);
    await page.waitForTimeout(holdMs);
  }
});

/** Wheel-like continuous zoom driven per animation frame inside the page. */
const sweepPhase = (page: Page) => record(page, () => page.evaluate(({ factor, min, times }) =>
  new Promise<void>(done => {
    const camera = (window as any).__ownerCamera;
    let direction = 1, turns = 0;
    camera.zoom = min;
    const tick = () => {
      camera.zoom = direction > 0 ? Math.min(3, camera.zoom * factor) : Math.max(min, camera.zoom / factor);
      if (camera.zoom >= 3 || camera.zoom <= min) { direction = -direction; turns += 1; }
      if (turns >= times * 2) { done(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), sweep));

/** Instance buffer bytes of every instanced mesh in the scene (vegetation memory). */
const instanceMemory = (page: Page) => page.evaluate(() => {
  const { renderer } = (window as any).__zv;
  const seen = new Set<any>();
  let bytes = 0;
  const add = (attribute: any) => {
    if (!attribute || seen.has(attribute)) return;
    seen.add(attribute);
    bytes += attribute.array.byteLength;
  };
  (window as any).__zvScene.traverse((object: any) => {
    if (!object.isInstancedMesh) return;
    add(object.instanceMatrix);
    for (const attribute of Object.values(object.geometry.attributes) as any[])
      if (attribute.isInstancedBufferAttribute) add(attribute);
  });
  return { geometries: renderer.info.memory.geometries, instanceBytes: bytes,
    jsHeap: (performance as any).memory?.usedJSHeapSize ?? 0, programs: renderer.info.programs?.length ?? 0 };
});

/** Programs (`name#keyLength:id`) labelled with the objects and materials of every rendered scene using them. */
const programOwners = (page: Page, names: string[]) => page.evaluate(list => {
  const { renderer } = (window as any).__zv;
  const owners = new Map<number, Set<string>>();
  const label = (object: any) => {
    const path: string[] = [];
    for (let node = object; node && path.length < 4; node = node.parent) path.push(node.name || node.type);
    const attributes = Object.keys(object.geometry?.attributes ?? {}).slice(0, 5).join(",");
    return `${path.join("<")}{${attributes}}`;
  };
  const add = (material: any, owner: string) => {
    const programs = renderer.properties.get(material)?.programs as Map<string, any> | undefined;
    for (const program of programs?.values() ?? []) {
      const set = owners.get(program.id) ?? new Set<string>();
      const uniforms = Object.keys(material.uniforms ?? {}).filter(name => !name.startsWith("uShadow")).slice(-4);
      set.add(`${material.type}:${material.name}[${uniforms.join(",")}]@${owner}`);
      owners.set(program.id, set);
    }
  };
  for (const scene of (window as any).__zvScenes as Set<any>) {
    if (scene.overrideMaterial) add(scene.overrideMaterial, `override ${label(scene)}`);
    scene.traverse((object: any) => {
      for (const material of [object.material].flat()) if (material) add(material, label(object));
    });
  }
  return list.map(name => `${name} ${[...owners.get(Number(name.split(":").at(-1))) ?? []].slice(0, 3).join(" | ")}`);
}, names);

/** Names of the compiled programs (first-use compiles show up as names added after a phase). */
const programNames = (page: Page) => page.evaluate(() => ((window as any).__zv.renderer.info.programs ?? [])
  .map((program: any) => `${program.name}#${String(program.cacheKey).length}:${program.id}`) as string[]);

const exposeRenderer = (source: string) => source.replace("const passNames",
  "window.__zv = { renderer }; window.__zvScene = scene; window.__zvScenes = new Set(); " +
  "const zvRender = renderer.render.bind(renderer); " +
  "renderer.render = (target, view) => { window.__zvScenes.add(target); return zvRender(target, view); }; " +
  "vegetation.ready.then(() => { window.__zvImpostorsAt = performance.now(); }); const passNames");

const openGame = async (url: string, quality: string) => {
  const browser = await launchBrowser(process.env.UNCAPPED === "1");
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 900, width: 1600 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name = value => value");
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: ADAPTIVE_PERFORMANCE_KEY, value: JSON.stringify({ auto: false, frameRateLimit: "display", lowestScale: "100" })
  });
  await installUploadCounter(page);
  await stageStartupSave(page, url, saveText);
  await installFrameProfiler(page, exposeRenderer);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&profile=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  /** Navigation start to the loading screen's removal. */
  const loadedAt = await page.evaluate(() => performance.now());
  return { browser, errors, loadedAt, page };
};

/** Far-zoom impostor bake arrival relative to the loading screen's removal (negative: behind it). */
const waitForImpostors = async (page: Page, loadedAt: number) => {
  await page.waitForFunction(() => (window as any).__zvImpostorsAt !== undefined, null, { timeout: 60_000 });
  return page.evaluate(at => (window as any).__zvImpostorsAt - at, loadedAt);
};

/** TRACE_STEP=<index>: a Chrome trace (GPU process tasks and decoder calls) around that zoom step. */
const TRACE_CATEGORIES = ["gpu", "gpu.service", "disabled-by-default-gpu.service", "disabled-by-default-gpu.decoder",
  "gpu.angle", "toplevel", "viz", "cc"];

/** TRACE_WARMUP=1: a lighter trace (GPU process and ANGLE only) from load to the impostor layer's readiness. */
const WARMUP_TRACE_CATEGORIES = ["gpu", "gpu.angle", "disabled-by-default-gpu.service"];

/** Zoom sequence of the first far zoom run (FIRST_ZOOMS=0.6,0.4 splits a non-impostor far zoom off). */
const firstZooms = (process.env.FIRST_ZOOMS ?? "0.4").split(",").map(Number);

/** One fresh High load: frames from load through the bake arrival to the first far zoom (0.4). */
const measureFirstZoom = async (url: string, run: number) => {
  const { browser, errors, loadedAt, page } = await openGame(url, process.env.FIRST_ZOOM_QUALITY ?? "high");
  await setZoom(page, 1.75);
  let impostorsAfterLoadMs = 0;
  let firstUsePrograms: string[] = [];
  const zoomFirstUses: Awaited<ReturnType<typeof firstUsesSince>>[] = [];
  const recorded = await record(page, async () => {
    const traceWarmup = process.env.TRACE_WARMUP === "1";
    if (traceWarmup) await browser.startTracing(page, { categories: WARMUP_TRACE_CATEGORIES,
      path: resolve(outputDir, `trace-warmup-${tag}-${run}.json`) });
    impostorsAfterLoadMs = await waitForImpostors(page, loadedAt);
    if (traceWarmup) await browser.stopTracing();
    await page.waitForTimeout(Number(process.env.FIRST_ZOOM_WAIT_MS ?? 3000));
    const known = new Set(await programNames(page));
    for (const [index, zoom] of firstZooms.entries()) {
      const before = await page.evaluate(() => performance.now());
      const tracing = process.env.TRACE_STEP === String(index);
      if (tracing) await browser.startTracing(page, { categories: TRACE_CATEGORIES,
        path: resolve(outputDir, `trace-${tag}-${run}-${zoom}.json`) });
      await setZoom(page, zoom);
      await page.waitForTimeout(holdMs * 2);
      if (tracing) await browser.stopTracing();
      zoomFirstUses.push(await firstUsesSince(page, before));
    }
    firstUsePrograms = await programOwners(page, (await programNames(page)).filter(name => !known.has(name)));
  });
  const recordedFrom = recorded.samples[0]?.at ?? 0;
  const atlases = (await page.evaluate(() => (window as any).__zvAtlases as { at: number }[]))
    .filter(atlas => atlas.at >= recordedFrom);
  await browser.close();
  assert.deepEqual(errors, []);
  return { firstUsePrograms, impostorsAfterLoadMs, zoomFirstUses, loadMs: loadedAt, run,
    atlases, ...summarizeFirstZoom(recorded.samples, recorded.marks, atlases[0]?.at) };
};

/** The zoom window split, the worst frame between the bake arrival and the zoom (warm-up cost). */
const summarizeFirstZoom = (samples: Sample[], marks: number[], atlasAt?: number) => {
  const zoomAt = marks.at(-firstZooms.length) ?? samples.length;
  const bakeAt = samples.findIndex(sample => sample.bakeReady);
  const worst = (list: Sample[]) => list.reduce((best, sample) => (sample.dt > best.dt ? sample : best), list[0]!);
  const zoomWindow = samples.slice(zoomAt, zoomAt + CHANGE_WINDOW);
  const afterBake = samples.slice(Math.max(0, bakeAt), zoomAt);
  // Atlas allocation (bake arrival on the lane, the first far zoom on master) to 3 frames after ready.
  const warmStart = atlasAt === undefined ? -1 : samples.findIndex(sample => sample.at >= atlasAt);
  const warmup = warmStart >= 0 && warmStart < bakeAt ? samples.slice(warmStart, bakeAt + 3) : [];
  const beforeBake = samples.slice(2, Math.max(2, bakeAt));
  const sum = (list: Sample[], key: SampleValue) => Number(list.reduce((total, sample) =>
    total + sample[key], 0).toFixed(1));
  return {
    afterBakeP99: percentile(afterBake.map(sample => sample.dt), .99),
    afterBakeWorst: worst(afterBake), warmupFrames: warmup.length,
    readyWorst: worst(samples.slice(Math.max(1, bakeAt - 1), bakeAt + 4)).dt,
    /** Frames before the layer became ready (warm-up bands and draws) and just after. */
    readyTrace: samples.slice(Math.max(1, bakeAt - 50), bakeAt + 4).map(sample =>
      [Math.round(sample.dt), Math.round(sample.cpu), Number(sample.texMs.toFixed(1))]),
    warmupMs: warmup.length ? Number((warmup.at(-1)!.at - warmup[0]!.at).toFixed(0)) : 0,
    warmupWorst: warmup.length ? worst(warmup) : null, warmupTexMs: sum(warmup, "texMs"), preZoomWorst: worst(samples.slice(2, zoomAt)), beforeBakeP99: percentile(beforeBake.map(sample => sample.dt), .99),
    zoomUploadMiB: Number((sum(zoomWindow, "bufBytes") / 2 ** 20).toFixed(2)),
    zoomCompileMs: sum(zoomWindow, "compileMs"), zoomTexMs: sum(zoomWindow, "texMs"), zoomBufMs: sum(zoomWindow, "bufMs"),
    zoomPrograms: (zoomWindow.at(-1)?.programs ?? 0) - (samples[zoomAt - 1]?.programs ?? 0),
    zoomWorst: worst(zoomWindow), stepWorst: marks.slice(-firstZooms.length).map(mark =>
      worst(samples.slice(mark, mark + CHANGE_WINDOW)).dt), laterZoomP99: percentile(samples.slice(zoomAt + CHANGE_WINDOW).map(s => s.dt), .99)
  };
};

const measureFirstZoomRuns = async (url: string, runs: number) => {
  const results: Awaited<ReturnType<typeof measureFirstZoom>>[] = [];
  for (let run = 0; run < runs; run++) {
    const result = await measureFirstZoom(url, run);
    console.log(JSON.stringify(result));
    results.push(result);
  }
  const median = (pick: (result: (typeof results)[number]) => number) => percentile(results.map(pick), .5);
  const summary = { afterBakeWorstMedian: median(result => result.afterBakeWorst.dt),
    preZoomWorstMedian: median(result => result.preZoomWorst.dt),
    loadMsMedian: median(result => result.loadMs), runs, tag, zoomWorstMedian: median(result => result.zoomWorst.dt) };
  writeFileSync(resolve(outputDir, `first-zoom-${tag}.json`), JSON.stringify({ results, summary }, null, 1));
  console.log(JSON.stringify(summary));
};

const measureQuality = async (url: string, quality: string) => {
  const { browser, errors, loadedAt, page } = await openGame(url, quality);
  const impostorsAfterLoadMs = await waitForImpostors(page, loadedAt);
  await setZoom(page, 1.75);
  await page.waitForTimeout(8000);
  const memory = await instanceMemory(page);
  await page.evaluate(() => (window as any).__ownerFrameStats.reset());
  const still = await record(page, () => page.waitForTimeout(holdMs * 4));
  const stillGpu = await page.evaluate(() => {
    const { gpuMs, gpuMsP95 } = (window as any).__ownerFrameStats.summarize();
    return { gpuMs, gpuMsP95 };
  });
  const steps: Record<string, Awaited<ReturnType<typeof record>>> = {};
  const compiled: Record<string, string[]> = {};
  let known = new Set(await programNames(page));
  for (const pair of stepPairs) {
    steps[pair.join(":")] = await stepPhase(page, pair);
    const names = await programNames(page);
    compiled[pair.join(":")] = names.filter(name => !known.has(name));
    known = new Set(names);
  }
  const sweeps = await sweepPhase(page);
  const memoryAfter = await instanceMemory(page);
  const profiled = process.env.PROFILE === "1" ? await profilePair(page, stepPairs[0]!) : null;
  const summaries = { still: { ...still.summary, ...stillGpu }, steps: Object.fromEntries(Object.entries(steps)
    .map(([key, value]) => [key, value.summary])), sweep: sweeps.summary };
  const report = { compiled, errors, impostorsAfterLoadMs, memory, memoryAfter, quality, tag, ...summaries, hot: profiled?.hot.slice(0, 25) };
  writeFileSync(resolve(outputDir, `${quality}-${tag}.json`), JSON.stringify({ ...report, marks: Object.fromEntries(
    Object.entries(steps).map(([key, value]) => [key, value.marks])), samples: {
    still: still.samples, steps: Object.fromEntries(Object.entries(steps).map(([key, value]) => [key, value.samples])),
    sweep: sweeps.samples } }, null, 1));
  if (profiled) writeFileSync(resolve(outputDir, `${quality}-${tag}.cpuprofile`), JSON.stringify(profiled.profile));
  console.log(JSON.stringify({ ...report, hot: profiled?.hot.slice(0, 12) }, null, 1));
  await browser.close();
  assert.deepEqual(errors, []);
};

const profilePair = async (page: Page, [low, high]: [number, number]) => {
  const sampling = sampleHotFunctions(page, holdMs * 4, 40);
  await setZoom(page, high);
  await page.waitForTimeout(holdMs * 2);
  await setZoom(page, low);
  return sampling;
};

const { server, url } = await startDevServer();
try {
  const firstZoomRuns = Number(process.env.FIRST_ZOOM_RUNS ?? 0);
  if (firstZoomRuns > 0) await measureFirstZoomRuns(url, firstZoomRuns);
  else for (const quality of (process.env.QUALITIES ?? "high,minimal").split(",")) await measureQuality(url, quality);
} finally {
  await server.close();
}
assert.equal(readFileSync(sourcePath, "utf8"), saveText, "Source save stays unchanged");
