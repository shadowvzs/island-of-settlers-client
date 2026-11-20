import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { deployCommander, recruitCommander } from "./commander-switch-fixture";

/**
 * C11 gate: iso -> possessed -> iso switch cost.
 *
 * The page records every rAF callback (start/end) and every long task. One cycle enters the
 * possessed view, waits for it to settle, leaves it and returns to iso. The report lists the
 * max/p95 frame interval and long tasks of each switch window.
 *
 * Usage (browser through captures/browser-slot.sh):
 *   npx tsx tools/bench/c11-possession-switch.ts --output=<dir> [--qualities=high,minimal]
 *     [--cycles=3] [--viewport=1440x900] [--mode=scout|commander] [--query=extra]
 *
 * `scout` uses the exploration controller (the same renderer prepare/lease as the commander).
 * `commander` recruits and deploys a commander and clicks the real "Control commander" button.
 */
const argument = (name: string) =>
  process.argv.find(entry => entry.startsWith(`--${name}=`))?.slice(name.length + 3);
const outputDir = argument("output");
assert(outputDir, "Pass --output=<dir>");
const qualities = (argument("qualities") ?? "high,minimal").split(",");
const cycles = Number(argument("cycles") ?? 3);
const mode = argument("mode") ?? "scout";
assert(["commander", "scout"].includes(mode), "Mode must be scout or commander");
const [width, height] = (argument("viewport") ?? "1440x900").split("x").map(Number);
const mapSeed = argument("seed") ?? "123";
const mapSize = argument("size") ?? "96";
const captures = argument("captures") !== "0";
/** Same-build A/B: even cycles run with the prewarm, odd cycles with the lazy path (or reversed). */
const alternate = argument("alternate") === "1";
const extraQuery = argument("query") ? `&${argument("query")}` : "";
mkdirSync(outputDir, { recursive: true });

const installFrameLog = () => {
  const host = window as any;
  host.__c11 = { events: [], frames: [], longTasks: [] };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => raf(time => {
    const started = performance.now();
    try { callback(time); }
    finally { host.__c11.frames.push({ ended: performance.now(), started }); }
  });
  const longTask = (entries: PerformanceObserverEntryList) => {
    for (const entry of entries.getEntries()) host.__c11.longTasks.push({
      duration: entry.duration, start: entry.startTime
    });
  };
  try { new PerformanceObserver(longTask).observe({ entryTypes: ["longtask"] }); }
  catch { /* long-task entries are optional */ }
  host.__c11.mark = (name: string) => host.__c11.events.push({ name, time: performance.now() });
};

const spawnEscort = (page: import("playwright-core").Page) => page.evaluate(async () => {
  const sim = (window as any).__settlement.simulation;
  await new Promise<void>(resolve => {
    const wait = () => {
      const commander = sim.commanderSnapshot();
      const soldier = sim.militarySoldiers().find((row: any) => row.commanderId === commander?.id);
      const actor = sim.frames().find((row: any) => row.uid === soldier?.actor);
      if (actor?.phase === "militaryField") resolve();
      else setTimeout(wait, 100);
    };
    wait();
  });
  const commander = sim.commanderSnapshot();
  const soldier = sim.militarySoldiers().find((row: any) => row.commanderId === commander.id);
  const actor = sim.frames().find((row: any) => row.uid === soldier.actor);
  const escorts: number[] = [];
  for (let index = 0; index < 6; index++) {
    const angle = index / 6 * Math.PI * 2;
    const spawned = sim.spawnDebugSoldier({
      x: actor.x + Math.cos(angle) * 2.5, z: actor.z + Math.sin(angle) * 2.5
    }, { rank: 0, type: "archer" });
    if (spawned) escorts.push(spawned.id);
  }
  sim.selectMilitary(escorts);
  return escorts;
});

const mark = (page: import("playwright-core").Page, name: string) =>
  page.evaluate(label => (window as any).__c11.mark(label), name);

/** The C06 counters at iso: far members must be back on the GPU after a possession switch. */
const readWorkerCounters = (page: import("playwright-core").Page) => page.evaluate(() => {
  const details = (window as any).__profileDetails ?? {};
  return {
    gpuCrowd: details.workerGpuCrowd ?? null,
    gpuSkipped: details.workerGpuSkipped ?? null,
    lods: details.workerLods ?? null
  };
});

/** Focus the headquarters at a zoom; wide (0.5) puts far members at LOD3, where C06 poses on the GPU. */
const focusIso = (page: import("playwright-core").Page, zoom: number) => page.evaluate(zoomLevel => {
  const live = (window as any).__settlement;
  const home = live.simulation.headquarters;
  live.focusGround(home.x, home.z, zoomLevel);
}, zoom);

/** Reads the GPU crowd at iso wide, then restores the normal zoom for the next cycle. */
const readIsoWideCounters = async (page: import("playwright-core").Page) => {
  await focusIso(page, 0.5);
  await page.waitForTimeout(1200);
  const counters = await readWorkerCounters(page);
  await focusIso(page, 1);
  await page.waitForTimeout(900);
  return counters;
};

const leaveView = async (page: import("playwright-core").Page) => {
  if (mode === "scout") {
    await page.evaluate(() => (window as any).__exploration.controller.requestLeave("leave"));
    await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "idle", null,
      { timeout: 30000 });
    return;
  }
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !(window as any).__commanderControl.owns(), null, { timeout: 30000 });
};

const enterView = async (page: import("playwright-core").Page) => {
  if (mode === "scout") {
    await page.evaluate(() => (window as any).__exploration.controller.enter());
    await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "possessed", null,
      { timeout: 60000 });
    return;
  }
  await page.getByRole("button", { name: "Control commander", exact: true }).click();
  try {
    await page.waitForFunction(() => (window as any).__commanderControl.controller.active(), null,
      { timeout: 60000 });
  } catch (error) {
    console.log("switch entry failed", JSON.stringify(await page.evaluate(() => ({
      debug: (window as any).__commanderControl.debug(),
      text: document.querySelector(".commander-control-host")?.textContent
    }))));
    throw error;
  }
};

const runCycle = async (page: import("playwright-core").Page, quality: string, cycle: number) => {
  await leaveView(page).catch(() => undefined);
  await page.waitForTimeout(900);
  const isoBefore = await readWorkerCounters(page);
  if (alternate) await page.evaluate(on => { (window as any).__explorationPrewarm = on; }, cycle % 2 === 0);
  await mark(page, `cycle-${cycle}-enter-request`);
  const startedAt = Date.now();
  await enterView(page);
  const enteredAt = Date.now();
  await mark(page, `cycle-${cycle}-active`);
  const capture = async (name: string) => {
    if (!captures) return;
    await mark(page, `cycle-${cycle}-capture-start`);
    await page.screenshot({ path: resolve(outputDir, `${quality}-cycle-${cycle}-${name}.png`) });
    await mark(page, `cycle-${cycle}-capture-end`);
  };
  await capture("first-possessed");
  await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().leaveUnlockInMs === 0,
    null, { timeout: 20000 });
  await page.waitForTimeout(250);
  await capture("possessed");
  await page.waitForTimeout(600);
  await mark(page, `cycle-${cycle}-leave-request`);
  await leaveView(page);
  await mark(page, `cycle-${cycle}-idle`);
  await page.waitForTimeout(1250);
  await capture("iso");
  const isoAfter = await readWorkerCounters(page);
  const isoWide = await readIsoWideCounters(page);
  return {
    cycle, enteredMs: enteredAt - startedAt, isoAfter, isoBefore, isoWide,
    prewarm: alternate ? cycle % 2 === 0 : true
  };
};

/** Twenty quiet possession cycles; GPU resource counters must return to a plateau. */
const measureMemoryPlateau = async (page: import("playwright-core").Page, quality: string) => {
  const samples: unknown[] = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    await enterView(page);
    await page.waitForTimeout(600);
    await leaveView(page);
    await page.waitForTimeout(1600);
    samples.push(await page.evaluate(() => ({
      resources: (window as any).__commanderControl.debug().resources,
      viewLeaseHeld: (window as any).__commanderControl.debug().viewLeaseHeld
    })));
  }
  // The hero release is deliberately delayed past the return transition; wait for it.
  await page.waitForTimeout(3000);
  const settled = await page.evaluate(() => (window as any).__commanderControl.debug().resources);
  const report = { quality, samples, settled };
  writeFileSync(resolve(outputDir, `${quality}-memory.json`), JSON.stringify(report, null, 2));
  console.log(`memory plateau ${quality}: ${JSON.stringify(settled)}`);
};

const readLog = (page: import("playwright-core").Page) => page.evaluate(() => {
  const host = (window as any).__c11;
  return { events: host.events, frames: host.frames, longTasks: host.longTasks };
});

interface FrameLog {
  events: Array<{ name: string; time: number }>;
  frames: Array<{ ended: number; started: number }>;
  longTasks: Array<{ duration: number; start: number }>;
}

const pick = (values: number[], share: number) => {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]! : 0;
};

interface CycleEntry {
  cycle: number;
  enteredMs: number;
  isoAfter?: unknown;
  isoBefore?: unknown;
  isoWide?: unknown;
  prewarm: boolean;
}

const summarize = (
  log: FrameLog,
  entered: readonly CycleEntry[]
) => {
  const frames = log.frames;
  // Page screenshots pause the compositor; a capture is tooling, not a gameplay frame.
  const captureWindows: [number, number][] = [];
  let captureStart: number | undefined;
  for (const event of log.events) {
    if (event.name.endsWith("-capture-start")) { captureStart = event.time; continue; }
    if (event.name.endsWith("-capture-end") && captureStart !== undefined) {
      captureWindows.push([captureStart, event.time]);
      captureStart = undefined;
    }
  }
  const captured = (time: number) =>
    captureWindows.some(([start, end]) => time >= start - 150 && time <= end + 150);
  const switchWindows = log.events.flatMap(event => {
    if (!event.name.endsWith("-enter-request")) return [];
    const prefix = event.name.slice(0, -"-enter-request".length);
    const leave = log.events.find(candidate => candidate.name === `${prefix}-leave-request`)?.time ?? Infinity;
    const idle = log.events.find(candidate => candidate.name === `${prefix}-idle`)?.time ?? Infinity;
    const samples = frames.flatMap((frame, index) => {
      if (index === 0) return [];
      return [{ at: frame.started - event.time, captured: captured(frame.started),
        interval: frame.started - frames[index - 1]!.started, work: frame.ended - frame.started }];
    }).filter(sample => !sample.captured && sample.at >= -350 && sample.at <= leave - event.time + 1500);
    const worstWork = samples.reduce((worst, sample) => sample.work > worst ? sample.work : worst, 0);
    const worstWorkAt = samples.find(sample => sample.work === worstWork)?.at ?? 0;
    const entry = entered.find(candidate => `cycle-${candidate.cycle}-enter-request` === event.name);
    return [{
      enteredMs: entry?.enteredMs ?? 0,
      idleMs: idle - leave,
      isoAfter: entry?.isoAfter,
      isoBefore: entry?.isoBefore,
      isoWide: entry?.isoWide,
      maxFrameIntervalMs: Math.max(0, ...samples.map(sample => sample.interval)),
      maxFrameWorkAtMs: worstWorkAt,
      maxFrameWorkMs: worstWork,
      prefix,
      prewarm: entry?.prewarm,
      slowFrames: samples.filter(sample => sample.interval > 50)
        .sort((first, second) => second.interval - first.interval).slice(0, 8)
    }];
  });
  const intervals = frames.flatMap((frame, index) =>
    index === 0 || captured(frame.started) ? [] : [frame.started - frames[index - 1]!.started]);
  const work = frames.flatMap(frame => captured(frame.started) ? [] : [frame.ended - frame.started]);
  return {
    cycles: switchWindows,
    frameCount: frames.length,
    longTasks: log.longTasks,
    maxFrameIntervalMs: Math.max(0, ...intervals),
    maxFrameWorkMs: Math.max(0, ...work),
    mode,
    p95FrameIntervalMs: pick(intervals, .95),
    p95FrameWorkMs: pick(work, .95)
  };
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const errors: string[] = [];
    const context = await browser.newContext({ viewport: { height: height!, width: width! } });
    await context.addInitScript(quality => {
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
    }, quality);
    // tsx injects `__name` wrappers into serialized functions; the page needs the helper first.
    await context.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
    await context.addInitScript(installFrameLog);
    const page = await context.newPage();
    page.on("pageerror", error => { errors.push(error.message); console.log(error.message); });
    await page.goto(`${url}admin.html?seed=${mapSeed}&size=${mapSize}&forest=0&cache=0&time=day&passes=1${extraQuery}`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady &&
      (window as any).__exploration), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    let fixture: unknown = undefined;
    if (mode === "commander") {
      fixture = await recruitCommander(page);
      await page.waitForTimeout(1500);
      await deployCommander(page);
      fixture = { ...(fixture as object), escorts: await spawnEscort(page) };
    }
    await page.waitForTimeout(2500);
    const entered: CycleEntry[] = [];
    for (let cycle = 0; cycle < cycles; cycle++) entered.push(await runCycle(page, quality, cycle));
    if (argument("memory") === "1" && mode === "commander") await measureMemoryPlateau(page, quality);
    const log = await readLog(page);
    const summary = { fixture, quality, ...summarize(log, entered) };
    writeFileSync(resolve(outputDir, `${quality}-switch.json`), JSON.stringify({ summary, log }, null, 2));
    console.log(JSON.stringify(summary));
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
