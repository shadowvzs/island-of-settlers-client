import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import type {
  ExplorationCameraBoundary,
  ExplorationPhase,
  ExplorationUiSnapshot
} from "../../src/app/exploration/contracts";
import type { GameRuntimeState } from "../../src/app/settlement/game-session";
import type { CameraState } from "../../src/render-common/camera-state";
import type { GameSaveV1 } from "../../src/shared/settlement/game-save";
import type { SettlementSaveV1 } from "../../src/shared/settlement/settlement-save-state";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";
import { saveFromMenu } from "./save-helpers";

/**
 * EXPLORE-01H native review, opt-in and serialized. It opens a fixed home fixture on a real GPU,
 * enters the portrait explorer through the real UI/hook, measures High/Minimal 256²/512² frame
 * times, checks desktop/mobile HUD targets, saves during possession and reloads the same game.
 *
 * EXPLORE-01G is not wired yet. When `window.__exploration` is absent the tool writes a
 * `not-wired` report and exits with code 2; it never presents a skipped measurement as evidence.
 *
 * `STORM=1` adds a separate opt-in EXPLORE-01H pass before the matrix: a fresh page loads `?rain=1`,
 * an init script instruments AudioContext.createBufferSource/createStereoPanner, and the pass enters
 * exploration through the real HUD button and waits up to ~30 s for a 2.2 s thunder voice. Its
 * report never changes the matrix status, and an unrequested storm is reported as `not-requested`.
 *
 * Run from `island-of-settlers-client/`:
 *   taskset -c 0 npx tsx tools/bench/home-exploration-review.ts
 *   STORM=1 taskset -c 0 npx tsx tools/bench/home-exploration-review.ts
 * The tool re-execs itself through taskset, so the documented command is the actual pinned run.
 * Env: QUALITIES=high,minimal SIZES=256,512 SEED=123 CYCLES=3 SECONDS=8 FIXTURE=<save.json>
 *      OUTPUT=<dir> CPU=0 CAPTURE=0 STORM=1 STORM_QUALITY=high STORM_WAIT_MS=30000
 */

const CPU = process.env.CPU ?? "0";
if (!process.env.HOME_EXPLORATION_REVIEW_PINNED) {
  execFileSync("taskset", [
    "-c", CPU, process.execPath, "node_modules/tsx/dist/cli.mjs",
    "tools/bench/home-exploration-review.ts"
  ], {
    env: { ...process.env, HOME_EXPLORATION_REVIEW_PINNED: "1" },
    stdio: "inherit"
  });
  process.exit(0);
}

const qualities = (process.env.QUALITIES ?? "high,minimal").split(",").map(value => value.trim());
const sizes = (process.env.SIZES ?? "256,512").split(",").map(Number);
if (qualities.some(quality => !["high", "minimal"].includes(quality)))
  throw new Error("QUALITIES must name high and/or minimal");
if (sizes.some(size => ![256, 512].includes(size)))
  throw new Error("SIZES must name 256 and/or 512");
const seed = Number(process.env.SEED ?? 123);
const cycles = Math.max(1, Math.floor(Number(process.env.CYCLES ?? 3)));
const captureEnabled = process.env.CAPTURE !== "0";
const sampleSeconds = Math.max(1, Number(process.env.SECONDS ?? 8));
const stormRequested = process.env.STORM === "1";
const stormQuality = process.env.STORM_QUALITY ?? "high";
if (!["high", "minimal"].includes(stormQuality))
  throw new Error("STORM_QUALITY must name high or minimal");
const stormWaitSetting = Number(process.env.STORM_WAIT_MS ?? 30_000);
const stormWaitMs = Number.isFinite(stormWaitSetting) ? Math.max(5_000, stormWaitSetting) : 30_000;
const fixture = process.env.FIXTURE ? resolve(process.env.FIXTURE) : null;
const output = (() => {
  if (process.env.OUTPUT) return resolve(process.env.OUTPUT);
  try { return resourcesPath("project-reviews", "home-exploration-current"); }
  catch { return resolve("/tmp/opencode/home-exploration-review"); }
})();
mkdirSync(output, { recursive: true });

const measuredAt = new Date().toISOString();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const workingTreeDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim());
const REQUIRED_HOOK = {
  "window.__exploration.camera": [
    "frame", "gameplayCamera", "savedRts", "setPose", "setBubble", "setAppearance", "setSmoke", "setWeather",
    "clearTransient"
  ],
  "window.__exploration.controller": [
    "enter", "requestLeave", "setMovement", "setLook", "toggleSpyglass", "update", "forceExit", "dispose",
    "snapshot", "frame", "phase"
  ],
  optionalForDiagnostics: ["ui", "gate", "hudScope"],
  requiredDom: [
    "[data-exploration-entry]", "[data-exploration-hud=hidden] (root attribute)",
    "[data-testid=exploration-ui]", "[data-exploration-control=spyglass]",
    "[data-exploration-control=leave]", "[data-exploration-control=joystick]",
    "[data-exploration-control=look]"
  ]
} as const;

interface FrameMetrics {
  elapsedMs: number;
  fps: number;
  frames: number;
  hitchesOver34Ms: number;
  hitchesOver50Ms: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

interface Diagnostics {
  heapMB: number | null;
  jsEventListeners: number | null;
  jsHeapUsedMB: number | null;
  nodes: number | null;
  workers: number | null;
}

interface HookState {
  keys: string[];
  missing: string[];
  wired: boolean;
}

const writeReport = (name: string, report: unknown) => {
  writeFileSync(resolve(output, name), `${JSON.stringify(report, null, 2)}\n`);
  return resolve(output, name);
};

const detectHook = (page: Page): Promise<HookState> => page.evaluate(() => {
  const hook = (window as unknown as {
    __exploration?: {
      camera?: Record<string, unknown>;
      controller?: Record<string, unknown>;
    };
  }).__exploration;
  if (!hook) return { keys: [], missing: ["window.__exploration"], wired: false };
  const missing: string[] = [];
  for (const method of [
    "enter", "requestLeave", "setMovement", "setLook", "toggleSpyglass", "update", "forceExit", "dispose",
    "snapshot", "frame", "phase"
  ])
    if (typeof hook.controller?.[method] !== "function") missing.push(`controller.${method}`);
  for (const method of [
    "savedRts", "gameplayCamera", "frame", "setPose", "setBubble", "setAppearance", "setSmoke", "setWeather",
    "clearTransient"
  ])
    if (typeof hook.camera?.[method] !== "function") missing.push(`camera.${method}`);
  return {
    keys: Object.keys(hook),
    missing,
    wired: missing.length === 0
  };
});

const phaseOf = (page: Page) => page.evaluate(() => (window as unknown as {
  __exploration: { controller: { phase: () => ExplorationPhase } };
}).__exploration.controller.phase());

const savedCameraOf = (page: Page) => page.evaluate(() => (window as unknown as {
  __exploration: { camera: { savedRts: () => ReturnType<ExplorationCameraBoundary["savedRts"]> } };
}).__exploration.camera.savedRts());

const rtsCamera = (camera: Readonly<CameraState>) => ({
  centerX: camera.centerX,
  centerZ: camera.centerZ,
  tilt: camera.tilt,
  yaw: camera.yaw,
  zoom: camera.zoom
});

const waitPhase = async (page: Page, expected: ExplorationPhase, timeout = 600_000) => {
  await page.waitForFunction(wanted => (window as unknown as {
    __exploration: { controller: { phase: () => ExplorationPhase } };
  }).__exploration.controller.phase() === wanted, expected, { timeout });
};

/** A screenshot can outlast a short visual phase; cooldown is followed by idle, never back by itself. */
const waitCooldownOrIdle = async (page: Page, timeout = 600_000) => {
  await page.waitForFunction(() => {
    const phase = (window as unknown as {
      __exploration: { controller: { phase: () => ExplorationPhase } };
    }).__exploration.controller.phase();
    return phase === "cooldown" || phase === "idle";
  }, null, { timeout });
};

const waitLeaveUnlocked = (page: Page) => page.waitForFunction(() => (window as unknown as {
  __exploration: { controller: { snapshot: () => ExplorationUiSnapshot } };
}).__exploration.controller.snapshot().leaveUnlockInMs === 0, null, { timeout: 600_000 });

const measureFrames = (page: Page, seconds: number): Promise<FrameMetrics> => page.evaluate(async durationSeconds => {
  const intervals: number[] = [];
  const start = await new Promise<number>(resolveFrame => requestAnimationFrame(resolveFrame));
  let previous = start;
  while (performance.now() - start < durationSeconds * 1_000) {
    const current = await new Promise<number>(resolveFrame => requestAnimationFrame(resolveFrame));
    intervals.push(current - previous);
    previous = current;
  }
  const elapsedMs = performance.now() - start;
  const sorted = [...intervals].sort((left, right) => left - right);
  const quantile = (value: number) => sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))]!
    : 0;
  return {
    elapsedMs,
    fps: intervals.length * 1_000 / elapsedMs,
    frames: intervals.length,
    hitchesOver34Ms: intervals.filter(value => value > 34).length,
    hitchesOver50Ms: intervals.filter(value => value > 50).length,
    maxMs: sorted.at(-1) ?? 0,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95)
  };
}, seconds);

/** Chrome's GPU object counters are diagnostics, not driver VRAM bytes. */
const installGpuCounters = (page: Page) => page.addInitScript(() => {
  const kinds = [
    ["buffer", "createBuffer", "deleteBuffer"],
    ["framebuffer", "createFramebuffer", "deleteFramebuffer"],
    ["program", "createProgram", "deleteProgram"],
    ["query", "createQuery", "deleteQuery"],
    ["renderbuffer", "createRenderbuffer", "deleteRenderbuffer"],
    ["sampler", "createSampler", "deleteSampler"],
    ["shader", "createShader", "deleteShader"],
    ["sync", "createSync", "deleteSync"],
    ["texture", "createTexture", "deleteTexture"],
    ["transformFeedback", "createTransformFeedback", "deleteTransformFeedback"],
    ["vertexArray", "createVertexArray", "deleteVertexArray"]
  ] as const;
  const ctor = (globalThis as unknown as {
    WebGL2RenderingContext?: { prototype: Record<string, unknown> };
    WebGLRenderingContext?: { prototype: Record<string, unknown> };
  }).WebGL2RenderingContext ?? (globalThis as unknown as {
    WebGLRenderingContext?: { prototype: Record<string, unknown> };
  }).WebGLRenderingContext;
  const state = {
    created: {} as Record<string, number>,
    deleted: {} as Record<string, number>,
    live: {} as Record<string, number>
  };
  if (ctor) {
    for (const [kind, createName, deleteName] of kinds) {
      const prototype = ctor.prototype;
      const create = prototype[createName] as ((...args: unknown[]) => unknown) | undefined;
      const remove = prototype[deleteName] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof create !== "function" || typeof remove !== "function") continue;
      const liveObjects = new Set<object>();
      state.created[kind] = 0;
      state.deleted[kind] = 0;
      state.live[kind] = 0;
      prototype[createName] = function (this: unknown, ...args: unknown[]) {
        const result = create.apply(this, args);
        if (result && typeof result === "object") {
          liveObjects.add(result);
          state.created[kind] = (state.created[kind] ?? 0) + 1;
          state.live[kind] = liveObjects.size;
        }
        return result;
      };
      prototype[deleteName] = function (this: unknown, ...args: unknown[]) {
        const [object] = args;
        if (object && typeof object === "object" && liveObjects.delete(object)) {
          state.deleted[kind] = (state.deleted[kind] ?? 0) + 1;
          state.live[kind] = liveObjects.size;
        }
        return remove.apply(this, args);
      };
    }
  }
  (window as unknown as {
    __homeExplorationGpu?: { snapshot: () => unknown; supported: boolean };
  }).__homeExplorationGpu = {
    snapshot: () => JSON.parse(JSON.stringify(state)),
    supported: Boolean(ctor)
  };
});

interface StormAudioSnapshot {
  buffers: { at: number; channels: number; duration: number | null; length: number; sampleRate: number }[];
  contexts: { currentTime: number; sampleRate: number; state: string }[];
  pannerCreations: number;
  pannedThunderStarts: number;
  resumes: number;
  sourcesCreated: number;
  starts: { at: number; channels: number | null; duration: number | null; length: number | null; sampleRate: number | null }[];
  stops: number;
  supported: boolean;
  thunderBuffers: number;
  thunderStarts: number;
  totalBuffers: number;
  totalStarts: number;
}

/**
 * EXPLORE-01H audio evidence without a production hook: count the 1-channel 2.2 s thunder buffers,
 * their buffer-source starts, and StereoPanner creations. The exploration weather sink creates a
 * panner for every thunder voice; the ordinary soundscape thunder path does not. Sound is switched
 * on before boot so the borrowed AudioContext exists after the real exploration-entry click.
 */
const prepareStormSound = (page: Page) => page.addInitScript(() => {
  (window as unknown as { __name?: (value: unknown) => unknown }).__name = value => value;
  try {
    localStorage.setItem("island-of-settlers.day-mode", "nature");
    localStorage.setItem("island-of-settlers.sound", "1");
    localStorage.setItem("island-of-settlers.sound.master-volume", "100");
    localStorage.setItem("island-of-settlers.sound.environment-volume", "100");
  } catch {
    // Storage may be unavailable; the storm pass then reports no audio context.
  }
});

const installStormAudioInstrumentation = (page: Page) => page.addInitScript(() => {
  interface BufferRecord {
    at: number;
    channels: number;
    duration: number | null;
    length: number;
    sampleRate: number;
  }
  interface StartRecord {
    at: number;
    channels: number | null;
    duration: number | null;
    length: number | null;
    sampleRate: number | null;
  }
  const state = {
    buffers: [] as BufferRecord[],
    pannerCreations: 0,
    pannedThunderStarts: 0,
    panners: [] as number[],
    resumes: 0,
    sourcesCreated: 0,
    starts: [] as StartRecord[],
    stops: 0,
    supported: false
  };
  const contexts: AudioContext[] = [];
  const seen = new WeakSet<BaseAudioContext>();
  const remember = (context: BaseAudioContext) => {
    if (seen.has(context)) return;
    seen.add(context);
    contexts.push(context as AudioContext);
  };
  const isThunder = (duration: number | null) =>
    duration !== null && Math.abs(duration - 2.2) <= 0.02;
  const audio = (globalThis as unknown as {
    AudioContext?: { prototype: Record<string, unknown> };
  }).AudioContext;
  if (audio) {
    state.supported = true;
    const prototype = audio.prototype;
    const createBuffer = prototype.createBuffer as
      ((this: BaseAudioContext, channels: number, length: number, sampleRate: number) => AudioBuffer) | undefined;
    if (createBuffer) prototype.createBuffer = function (
      this: BaseAudioContext, channels: number, length: number, sampleRate: number
    ) {
      remember(this);
      const buffer = createBuffer.call(this, channels, length, sampleRate);
      state.buffers.push({
        at: Date.now(),
        channels,
        duration: Number.isFinite(buffer.duration) ? buffer.duration : null,
        length,
        sampleRate
      });
      if (state.buffers.length > 400) state.buffers.shift();
      return buffer;
    };
    const createBufferSource = prototype.createBufferSource as
      ((this: BaseAudioContext) => AudioBufferSourceNode) | undefined;
    if (createBufferSource) prototype.createBufferSource = function (this: BaseAudioContext) {
      remember(this);
      state.sourcesCreated++;
      const source = createBufferSource.call(this);
      const start = source.start.bind(source);
      (source as unknown as { start: (...args: number[]) => void }).start = (...args: number[]) => {
        const buffer = source.buffer;
        const entry: StartRecord = {
          at: Date.now(),
          channels: buffer?.numberOfChannels ?? null,
          duration: buffer?.duration ?? null,
          length: buffer?.length ?? null,
          sampleRate: buffer?.sampleRate ?? null
        };
        state.starts.push(entry);
        if (state.starts.length > 400) state.starts.shift();
        const pannerAt = state.panners.at(-1);
        if (isThunder(entry.duration) && pannerAt !== undefined && entry.at - pannerAt <= 250)
          state.pannedThunderStarts++;
        return start(...args);
      };
      const stop = source.stop.bind(source);
      (source as unknown as { stop: (...args: number[]) => void }).stop = (...args: number[]) => {
        state.stops++;
        return stop(...args);
      };
      return source;
    };
    const createStereoPanner = prototype.createStereoPanner as
      ((this: BaseAudioContext) => StereoPannerNode) | undefined;
    if (createStereoPanner) prototype.createStereoPanner = function (this: BaseAudioContext) {
      remember(this);
      state.pannerCreations++;
      state.panners.push(Date.now());
      if (state.panners.length > 400) state.panners.shift();
      return createStereoPanner.call(this);
    };
    const resume = prototype.resume as ((this: AudioContext) => Promise<void>) | undefined;
    if (resume) prototype.resume = function (this: AudioContext) {
      remember(this);
      state.resumes++;
      return resume.call(this);
    };
  }
  (window as unknown as {
    __stormAudio?: { snapshot: () => unknown };
  }).__stormAudio = {
    snapshot: () => ({
      buffers: state.buffers.slice(-40),
      contexts: contexts.slice(-4).map(context => ({
        currentTime: Math.round(context.currentTime * 1_000) / 1_000,
        sampleRate: context.sampleRate,
        state: context.state
      })),
      pannerCreations: state.pannerCreations,
      pannedThunderStarts: state.pannedThunderStarts,
      resumes: state.resumes,
      sourcesCreated: state.sourcesCreated,
      starts: state.starts.slice(-40),
      stops: state.stops,
      supported: state.supported,
      thunderBuffers: state.buffers.filter(buffer => isThunder(buffer.duration)).length,
      thunderStarts: state.starts.filter(start => isThunder(start.duration)).length,
      totalBuffers: state.buffers.length,
      totalStarts: state.starts.length
    })
  };
});

const readStormAudio = (page: Page): Promise<StormAudioSnapshot | null> => page.evaluate(() =>
  ((window as unknown as { __stormAudio?: { snapshot: () => StormAudioSnapshot } }).__stormAudio?.snapshot()) ?? null);

const readStormState = (page: Page) => page.evaluate(() => {
  const hook = (window as unknown as {
    __exploration?: {
      camera?: { frame?: () => { revision?: number; weather?: { rain?: number } | null } };
      controller?: { phase?: () => string };
    };
  }).__exploration;
  const frame = hook?.camera?.frame?.();
  return {
    frameRevision: frame?.revision ?? null,
    phase: hook?.controller?.phase?.() ?? null,
    rain: frame?.weather?.rain ?? null,
    weather: frame?.weather ?? null
  };
});

/** EXPLORE-01H: storm trigger -> bounded thunder voice, in a separate context so the matrix is untouched. */
const runStormPass = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { height: 900, width: 1600 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("404 (Not Found)"))
      errors.push(message.text());
  });
  const report: Record<string, unknown> = {
    measuredAt,
    output,
    quality: stormQuality,
    requested: true,
    sourceCommit,
    status: "failed",
    workingTreeDirty
  };
  try {
    await prepareStormSound(page);
    await installStormAudioInstrumentation(page);
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.goto(`${url}?rain=1&quality=${stormQuality}&size=64&seed=123&mountains=0&forest=0&cache=0&time=day`);
    await page.waitForFunction(() => Boolean((window as unknown as { __islandReady?: boolean }).__islandReady), null,
      { timeout: 600_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 600_000 });
    report.gpu = await readGpuInfo(page);
    const hook = await detectHook(page);
    report.hook = hook;
    if (!hook.wired) {
      report.status = "not-wired";
      report.measured = false;
      report.reason = "window.__exploration is not wired; the storm pass cannot enter exploration.";
      return report;
    }
    report.baseline = await readStormAudio(page);
    await page.screenshot({ path: resolve(output, "storm-rain-home.png") });
    const entry = page.locator("[data-exploration-entry]");
    await entry.waitFor({ state: "visible", timeout: 120_000 });
    report.entryDisabled = await entry.isDisabled();
    if (report.entryDisabled) throw new Error("The exploration entry is disabled in the storm fixture");
    const entryStarted = Date.now();
    await entry.click();
    await waitPhase(page, "possessed", 600_000);
    report.entryMs = Date.now() - entryStarted;
    report.possessed = await readStormState(page);
    report.audioAfterEntry = await readStormAudio(page);
    await page.screenshot({ path: resolve(output, "storm-possessed.png") });

    const baseline = report.baseline as StormAudioSnapshot | null;
    const afterEntry = report.audioAfterEntry as StormAudioSnapshot | null;
    // A strike may already have fired while entering: wait for a fresh voice after possession.
    const baselineThunder = afterEntry?.thunderStarts ?? baseline?.thunderStarts ?? 0;
    const baselinePanned = afterEntry?.pannedThunderStarts ?? baseline?.pannedThunderStarts ?? 0;
    const waitStarted = Date.now();
    let observed = false;
    try {
      await page.waitForFunction(({ panned, thunder }) => {
        const snapshot = (window as unknown as {
          __stormAudio?: { snapshot: () => StormAudioSnapshot };
        }).__stormAudio?.snapshot();
        if (!snapshot) return false;
        return snapshot.thunderStarts > thunder && snapshot.pannedThunderStarts > panned;
      }, { panned: baselinePanned, thunder: baselineThunder }, { polling: 100, timeout: stormWaitMs });
      observed = true;
    } catch {
      observed = false;
    }
    report.thunderWaitMs = Date.now() - waitStarted;
    report.after = await readStormAudio(page);
    report.state = await readStormState(page);
    const after = report.after as StormAudioSnapshot | null;
    const thunderDelta = (after?.thunderStarts ?? 0) - baselineThunder;
    const pannedDelta = (after?.pannedThunderStarts ?? 0) - baselinePanned;
    const rain = (report.state as { rain?: number | null }).rain ?? null;
    report.lightning = {
      frame: null,
      note: "EXPLORE-01H exposes no lightning-frame stats hook; the exploration panner voice is the attribution.",
      observed,
      observedVia: "thunder-voice",
      stats: null,
      strikeVoices: Math.max(0, pannedDelta)
    };
    report.rain = rain;
    report.stormActive = typeof rain === "number" && rain > 0.55;
    report.flash = {
      capturedAtMs: report.thunderWaitMs,
      screenshot: observed ? "storm-thunder.png" : "storm-timeout.png"
    };
    await page.screenshot({ path: resolve(output, observed ? "storm-thunder.png" : "storm-timeout.png") });
    if (observed) {
      await page.waitForTimeout(100);
      await page.screenshot({ path: resolve(output, "storm-thunder-100ms.png") });
    }
    const stormPass = observed && report.stormActive === true && thunderDelta > 0 && pannedDelta > 0;
    report.pass = stormPass;
    report.status = stormPass ? "measured" : "failed";
    report.measured = stormPass;
    report.thunder = {
      afterEntryStarts: afterEntry?.thunderStarts ?? null,
      beforeEntryStarts: baseline?.thunderStarts ?? null,
      deltaAfterPossession: thunderDelta,
      pannedDeltaAfterPossession: pannedDelta,
      thunderBuffers: after?.thunderBuffers ?? null,
      thunderStarts: after?.thunderStarts ?? null
    };
    if (!stormPass) {
      report.reason = observed
        ? "A thunder voice started but the storm/rain or exploration-voice attribution was incomplete."
        : `No 2.2 s thunder voice with a StereoPanner started within ${String(stormWaitMs)} ms.`;
    }
    return report;
  } catch (error) {
    report.error = (error as Error).message;
    report.status = "failed";
    report.measured = false;
    return report;
  } finally {
    report.errors = errors;
    await context.close();
  }
};

const readDiagnostics = async (page: Page): Promise<Diagnostics & { gpuObjects: unknown }> => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = await cdp.send("Performance.getMetrics");
  const metric = (name: string) => metrics.metrics.find(entry => entry.name === name)?.value ?? null;
  let workers: number | null = null;
  try {
    const targets = await cdp.send("Target.getTargets");
    workers = targets.targetInfos.filter(target =>
      target.type === "worker" || target.type === "service_worker" || target.type === "shared_worker"
    ).length;
  } catch {
    workers = null;
  }
  await cdp.detach();
  const gpuObjects = await page.evaluate(() => (window as unknown as {
    __homeExplorationGpu?: { snapshot: () => unknown };
  }).__homeExplorationGpu?.snapshot() ?? null);
  const heap = metric("JSHeapUsedSize");
  return {
    gpuObjects,
    heapMB: heap === null ? null : heap / 1_048_576,
    jsEventListeners: metric("JSEventListeners"),
    jsHeapUsedMB: heap === null ? null : heap / 1_048_576,
    nodes: metric("Nodes"),
    workers
  };
};

const readGpuInfo = (page: Page) => page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  return {
    agent: navigator.userAgent,
    dpr: devicePixelRatio,
    renderer: debug ? String(gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "unknown",
    viewport: { height: innerHeight, width: innerWidth }
  };
});

const freezeSimulation = (page: Page) => page.evaluate(() => {
  const simulation = (window as unknown as {
    __settlement?: { simulation: { update: () => void; __homeExplorationReviewUpdate?: () => void } };
  }).__settlement?.simulation;
  if (!simulation) throw new Error("The settlement simulation is not available");
  simulation.__homeExplorationReviewUpdate ??= simulation.update;
  simulation.update = () => undefined;
});

const openHome = async (page: Page, quality: string, size: number) => {
  await page.addInitScript(() => {
    (window as unknown as { __name?: (value: unknown) => unknown }).__name = value => value;
  });
  await installGpuCounters(page);
  await page.routeWebSocket("**/*", () => {});
  if (fixture) {
    await page.route("**/home-exploration-fixture.html", route => route.fulfill({
      contentType: "text/html", body: "<body>Preparing the fixed home exploration fixture</body>"
    }));
    await page.goto(`${url}home-exploration-fixture.html`);
    await page.evaluate(async saved => {
      const module = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      await (await module.openLocalSaveStore()).writeStartupGame(saved);
    }, readFileSync(fixture, "utf8"));
    await page.goto(`${url}?quality=${quality}&cache=0`);
  } else {
    await page.goto(`${url}?quality=${quality}&size=${size}&seed=${seed}&cache=0`);
  }
  await page.waitForFunction(() => Boolean((window as unknown as { __islandReady?: boolean }).__islandReady), null, {
    timeout: 600_000
  });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 600_000 });
};

const ledger = (state: SettlementSaveV1) => {
  const totals: Record<string, number> = {};
  const add = (goods: Readonly<Record<string, number>> | undefined) => {
    for (const [ware, quantity] of Object.entries(goods ?? {}))
      if (quantity) totals[ware] = (totals[ware] ?? 0) + quantity;
  };
  for (const building of state.buildings) {
    add(building.input);
    add(building.output);
    add(building.inventory);
    add(building.workshopUpgrade?.reserved);
    add(building.constructionConsumed);
  }
  for (const actor of state.actors) {
    if (actor.ware) add({ [actor.ware]: actor.wareUnits ?? 1 });
    if (actor.tool) add({ [`equipped:${actor.tool}`]: 1 });
    add(actor.consumed);
    add(actor.demolitionCargo);
  }
  for (const ship of state.naval.fleet.ships) add(ship.cargo);
  return totals;
};

const holdings = (state: SettlementSaveV1) => ({
  actors: state.actors.length,
  buildings: state.buildings.map(building => [building.uid, building.typeId, building.idleSettlers]),
  ledger: ledger(state),
  settlers: state.settlers,
  ships: state.naval.fleet.ships.length,
  soldiers: state.military?.soldiers.length ?? 0
});

const readSavedGame = (page: Page) => page.evaluate(async () => {
  const module = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
  return await (await module.openLocalSaveStore()).readSavedGame();
});

const assertNoExplorationFields = (runtime: unknown) => {
  const forbidden = [
    "bubble", "cooldown", "exploration", "explorationFrame", "explorationPhase", "explorer", "firstPerson",
    "fpsPose", "presentationSeed", "smoke", "spyglass", "temporaryFog"
  ];
  const serialized = JSON.stringify(runtime);
  for (const key of forbidden) assert(!serialized.includes(`"${key}"`), `runtime leaked ${key}`);
  const state = runtime as GameRuntimeState;
  const camera = state.camera;
  assert.deepEqual(Object.keys(camera).sort(), ["centerX", "centerZ", "tilt", "yaw", "zoom"]);
  assert.equal(state.viewMode ?? "iso", "iso", "the saved view mode stays ordinary isometric");
};

const captureControlGeometry = async (page: Page, label: string) => {
  const results: Record<string, { height: number; width: number; visible: boolean }> = {};
  for (const control of ["joystick", "look", "spyglass", "leave"]) {
    const locator = page.locator(`[data-exploration-control="${control}"]`);
    const visible = await locator.isVisible();
    const box = await locator.boundingBox();
    results[control] = {
      height: box?.height ?? 0,
      visible,
      width: box?.width ?? 0
    };
  }
  await page.screenshot({ path: resolve(output, `${label}-mobile-controls.png`) });
  return results;
};

const runCycle = async (page: Page, cycle: number, capture: boolean, saveDuringCycle: boolean) => {
  const beforeState = await page.evaluate(() => (window as unknown as {
    __settlement: { simulation: { saveState: () => SettlementSaveV1 } };
  }).__settlement.simulation.saveState());
  const beforeCamera = await savedCameraOf(page);

  const entryStarted = Date.now();
  const entryResult = page.evaluate(async () => await (window as unknown as {
    __exploration: { controller: { enter: () => Promise<{ ok: boolean; reason?: string }> } };
  }).__exploration.controller.enter());
  await waitPhase(page, "entering");
  const enteringAt = Date.now();
  let screenshotEnteringMs = 0;
  if (capture) {
    const screenshotStarted = Date.now();
    await page.screenshot({ path: resolve(output, `cycle-${cycle}-entering.png`) });
    screenshotEnteringMs = Date.now() - screenshotStarted;
  }
  await waitPhase(page, "possessed", 600_000);
  assert.deepEqual(await entryResult, { ok: true }, "exploration entry must succeed for the native review");
  const possessedAt = Date.now();
  const possessedMetrics = await measureFrames(page, sampleSeconds);
  const duringState = await page.evaluate(() => (window as unknown as {
    __settlement: { simulation: { saveState: () => SettlementSaveV1 } };
  }).__settlement.simulation.saveState());
  if (capture) await page.screenshot({ path: resolve(output, `cycle-${cycle}-possessed.png`) });

  await waitLeaveUnlocked(page);
  const spyglass = page.locator('[data-exploration-control="spyglass"]');
  const leave = page.locator('[data-exploration-control="leave"]');
  assert(await spyglass.isVisible(), "the spyglass control is visible");
  await spyglass.click();
  assert.equal(await spyglass.getAttribute("aria-pressed"), "true", "spyglass is pressed");
  const spyglassMetrics = await measureFrames(page, Math.max(3, Math.floor(sampleSeconds / 2)));
  if (capture) await page.screenshot({ path: resolve(output, `cycle-${cycle}-spyglass.png`) });
  await spyglass.click();

  let saved: GameSaveV1 | null = null;
  if (saveDuringCycle) {
    await saveFromMenu(page);
    saved = await readSavedGame(page) as GameSaveV1 | null;
    assert(saved, "the live save coordinator wrote a game during possession");
    assert.deepEqual(holdings(saved.settlement), holdings(beforeState), "save goods changed while possessed");
    assert.deepEqual((saved.runtime as GameRuntimeState).camera, rtsCamera(beforeCamera), "saved camera is the RTS camera");
    assertNoExplorationFields(saved.runtime);
  }

  const leaveStarted = Date.now();
  await leave.click();
  await waitPhase(page, "returning");
  if (capture) await page.screenshot({ path: resolve(output, `cycle-${cycle}-returning.png`) });
  // Do not wait for the exact transient cooldown after a potentially slow screenshot: it may have
  // already advanced to idle. The important acceptance state is the final idle phase.
  await waitCooldownOrIdle(page, 600_000);
  const cooldownAt = Date.now();
  if (capture && await page.evaluate(() => (window as unknown as {
    __exploration: { controller: { phase: () => ExplorationPhase } };
  }).__exploration.controller.phase()) === "cooldown")
    await page.screenshot({ path: resolve(output, `cycle-${cycle}-cooldown.png`) });
  await waitPhase(page, "idle", 600_000);
  const afterState = await page.evaluate(() => (window as unknown as {
    __settlement: { simulation: { saveState: () => SettlementSaveV1 } };
  }).__settlement.simulation.saveState());
  const afterCamera = await savedCameraOf(page);
  assert.deepEqual(holdings(afterState), holdings(beforeState), "cycle changed goods/population");
  assert.deepEqual(afterCamera, beforeCamera, "cycle changed the canonical RTS camera");

  return {
    afterCamera,
    afterHoldings: holdings(afterState),
    beforeHoldings: holdings(beforeState),
    cooldownMs: cooldownAt - leaveStarted,
    duringHoldings: holdings(duringState),
    /** Request -> entering. */
    entryMs: enteringAt - entryStarted,
    /** Entering -> possessed, excluding the diagnostic screenshot that can dominate a high-res run. */
    possessionMs: possessedAt - enteringAt - screenshotEnteringMs,
    screenshotEnteringMs,
    metrics: { possessed: possessedMetrics, spyglass: spyglassMetrics },
    savedGame: saved,
    savedSummary: saved && {
      holdings: holdings(saved.settlement),
      runtimeCamera: (saved.runtime as GameRuntimeState).camera
    }
  };
};

const runQualitySize = async (browser: Browser, quality: string, size: number) => {
  const context = await browser.newContext({ viewport: { height: 900, width: 1600 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    // The dev server has no favicon; that 404 is not a WebGL/game error.
    if (message.type() === "error" && !message.text().includes("404 (Not Found)"))
      errors.push(message.text());
  });

  const report: Record<string, unknown> = {
    measuredAt,
    quality,
    seed,
    size,
    sourceCommit,
    workingTreeDirty,
    fixture,
    sampleSeconds,
    cycles,
    serialized: true,
    tasksetCpu: CPU
  };

  try {
    await openHome(page, quality, size);
    report.gpu = await readGpuInfo(page);
    const hook = await detectHook(page);
    report.hook = hook;
    if (!hook.wired) {
      report.status = "not-wired";
      report.measured = false;
      report.reason = "EXPLORE-01G has not exposed window.__exploration; no native exploration evidence was produced.";
      report.requiredHook = REQUIRED_HOOK;
      report.errors = errors;
      await context.close();
      return report;
    }

    await freezeSimulation(page);
    report.diagnosticsBaseline = await readDiagnostics(page);
    report.frames = { isometricBaseline: await measureFrames(page, sampleSeconds) };

    const cycleReports = [];
    const diagnosticsByCycle = [];
    let savedFromPossession: GameSaveV1 | null = null;
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      const result = await runCycle(page, cycle, captureEnabled && cycle === 1, cycle === 1);
      const { savedGame, ...summary } = result;
      if (savedGame && !savedFromPossession) savedFromPossession = savedGame;
      cycleReports.push(summary);
      diagnosticsByCycle.push(await readDiagnostics(page));
      if (cycle === 1) report.frames = {
        ...(report.frames as Record<string, unknown>),
        isometricDuringCooldown: await measureFrames(page, Math.max(3, Math.floor(sampleSeconds / 2)))
      };
    }
    report.cycleReports = cycleReports;
    report.diagnosticsByCycle = diagnosticsByCycle;
    report.frames = {
      ...(report.frames as Record<string, unknown>),
      isometricAfter: await measureFrames(page, sampleSeconds)
    };
    report.diagnosticsAfterCycles = await readDiagnostics(page);
    const warmup = (diagnosticsByCycle[0] ?? report.diagnosticsAfterCycles) as Awaited<ReturnType<typeof readDiagnostics>>;
    const after = report.diagnosticsAfterCycles as Awaited<ReturnType<typeof readDiagnostics>>;
    report.diagnosticsDelta = {
      heapMB: warmup.heapMB === null || after.heapMB === null ? null : after.heapMB - warmup.heapMB,
      jsEventListeners: warmup.jsEventListeners === null || after.jsEventListeners === null ? null
        : after.jsEventListeners - warmup.jsEventListeners,
      nodes: warmup.nodes === null || after.nodes === null ? null : after.nodes - warmup.nodes,
      workers: warmup.workers === null || after.workers === null ? null : after.workers - warmup.workers
    };
    const delta = report.diagnosticsDelta as {
      heapMB: number | null; jsEventListeners: number | null; nodes: number | null; workers: number | null;
    };
    assert.ok(delta.workers === null || delta.workers === 0, "worker count must not grow across cycles");
    assert.ok(delta.heapMB === null || delta.heapMB <= 64,
      `heap grew by ${String(delta.heapMB)} MB across ${cycles} cycle(s)`);
    assert.ok(delta.jsEventListeners === null || delta.jsEventListeners <= 256,
      `event listeners grew by ${String(delta.jsEventListeners)} across ${cycles} cycle(s)`);
    assert.ok(delta.nodes === null || delta.nodes <= 2_000,
      `DOM nodes grew by ${String(delta.nodes)} across ${cycles} cycle(s)`);

    const saveParity = await verifySaveReload(page, savedFromPossession);
    report.saveParity = saveParity;
    assert.equal(saveParity.status, "measured", "save/reload parity must be measured");
    const mobile = await captureMobileControls(browser, quality, size);
    report.mobile = mobile;
    assert.equal(mobile.status, "measured", "mobile control geometry must be measured");
    report.status = "measured";
    report.measured = true;
    report.errors = errors;
    assert.deepEqual(errors, [], "page errors during the native review");
    return report;
  } catch (error) {
    report.status = "failed";
    report.measured = false;
    report.error = (error as Error).message;
    report.errors = errors;
    return report;
  } finally {
    await context.close();
  }
};

const captureMobileControls = async (browser: Browser, quality: string, size: number) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await openHome(page, quality, size);
    const hook = await detectHook(page);
    if (!hook.wired) return { status: "not-wired", errors };
    await page.locator("[data-exploration-entry]").tap();
    await waitPhase(page, "possessed", 600_000);
    const geometry = await captureControlGeometry(page, `${quality}-${size}`);
    const controls = Object.entries(geometry);
    const failures = controls.filter(([, box]) =>
      !box.visible || box.width < 48 || box.height < 48
    ).map(([name]) => name);
    return { errors, failures, geometry, status: failures.length ? "failed" : "measured" };
  } catch (error) {
    return { errors, reason: (error as Error).message, status: "failed" };
  } finally {
    await context.close();
  }
};

/** Writes the exact payload captured during possession and reloads into it (not a later autosave). */
const resumeExactSavedGame = async (page: Page, saved: GameSaveV1) => {
  const loaded = page.waitForEvent("load", { timeout: 600_000 });
  await page.evaluate(async value => {
    const module = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const store = await module.openLocalSaveStore();
    await store.writeStartupGame(value);
    location.reload();
  }, JSON.stringify(saved)).catch(() => undefined);
  await loaded;
  await page.waitForFunction(() => Boolean((window as unknown as { __islandReady?: boolean }).__islandReady), null, {
    timeout: 600_000
  });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 600_000 });
};

const verifySaveReload = async (page: Page, saved: GameSaveV1 | null) => {
  if (!saved) return { status: "not-measured", reason: "No save was captured during possession." };
  const savedHoldings = holdings(saved.settlement);
  const savedRuntime = saved.runtime as GameRuntimeState;
  assertNoExplorationFields(savedRuntime);
  await resumeExactSavedGame(page, saved);
  const hook = await detectHook(page);
  assert(hook.wired, "window.__exploration must be available after a normal reload");
  await waitPhase(page, "idle");
  const hiddenHud = await page.locator("html").getAttribute("data-exploration-hud");
  assert.equal(hiddenHud, null, "reload starts in the normal HUD");
  const restored = await page.evaluate(() => (window as unknown as {
    __settlement: { simulation: { saveState: () => SettlementSaveV1 } };
  }).__settlement.simulation.saveState());
  const restoredHoldings = holdings(restored);
  // A normal live reload resumes at the server/device now and may advance births, production and
  // consumption; the authoritative saved payload was compared above before the reload. Record the
  // live delta instead of treating legitimate post-catch-up progression as an exploration leak.
  const restoredCamera = await savedCameraOf(page);
  assert.deepEqual(rtsCamera(restoredCamera), savedRuntime.camera, "reload changed the saved RTS camera");
  return {
    camera: restoredCamera,
    holdings: restoredHoldings,
    phase: await phaseOf(page),
    liveReloadDelta: restoredHoldings,
    savedHoldings,
    status: "measured"
  };
};

// `url` is assigned by main before any page starts; openHome closes over it.
let url = "";

const main = async () => {
  const started = await startDevServer({ unlockAll: false });
  url = started.url;
  const browser = await launchBrowser();
  const reports: unknown[] = [];
  let stormReport: Record<string, unknown> | null = null;
  try {
    if (stormRequested) {
      stormReport = await runStormPass(browser);
      const path = writeReport("storm.json", stormReport);
      console.log(`${String(stormReport.status)} storm: ${path}`);
    }
    for (const quality of qualities) {
      for (const size of sizes) {
        const report = await runQualitySize(browser, quality, size);
        reports.push(report);
        if (report.status === "not-wired") {
          const path = writeReport("not-wired.json", {
            measuredAt,
            seed,
            sizes,
            qualities,
            sourceCommit,
            workingTreeDirty,
            status: "not-wired",
            measured: false,
            reason: "EXPLORE-01G has not exposed window.__exploration; no native exploration evidence was produced.",
            requiredHook: REQUIRED_HOOK,
            detected: report.hook,
            quality,
            size
          });
          console.log(`not-wired: ${String(report.reason)} (${path})`);
          process.exitCode = 2;
          return;
        }
        const path = writeReport(`${quality}-${size}.json`, report);
        console.log(`${String(report.status)} ${quality} ${size}: ${path}`);
      }
    }
  } finally {
    const measured = reports.some(report => (report as { measured?: boolean }).measured === true);
    const notWired = reports.some(report => (report as { status?: string }).status === "not-wired");
    let status = "failed";
    if (notWired) status = "not-wired";
    else if (measured) status = "measured";
    writeReport("summary.json", {
      measuredAt,
      measured,
      status,
      reports,
      sourceCommit,
      storm: stormReport ?? { measured: false, requested: false, status: "not-requested" },
      stormRequested,
      workingTreeDirty
    });
    if (stormRequested && stormReport?.status !== "measured" && process.exitCode !== 2)
      process.exitCode = 1;
    await browser.close();
    await started.server.close();
  }
  if (process.exitCode !== 2 &&
    reports.some(report => (report as { status?: string }).status !== "measured"))
    process.exitCode = 1;
};

await main();
