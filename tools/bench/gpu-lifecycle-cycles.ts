import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, CDPSession, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { deployCommander, recruitCommander, waitCommanderInField } from "./commander-switch-fixture";
import { stageStartupSave } from "./frame-profile";
import {
  installGpuLifecycleProbe, type LifecycleSample, sampleLifecycle, writeHeapSnapshot
} from "./gpu-lifecycle-probe";
import { prepareColonyFixture } from "./island-handoff-fixture";

/**
 * GPU-LIFECYCLE-03 cycle harness. Each scenario opens a fresh page on the owner save (its composed
 * colony, or a generated 96² map for the commander), runs WARMUP cycles, then CYCLES cycles of
 * one switch and samples live WebGL objects, three.js info, listeners, intervals, workers and the
 * collected JS heap after every cycle.
 *
 *   SAVE=<home save.json> OUTPUT_DIR=<dir> [SCENARIOS=idle,scout,commander,zoom,buildings,tone,detail,island]
 *   [QUALITY=high] [CYCLES=20] [WARMUP=2] [VIEWPORT=1280x800] [SHOTS=1] [TRACE=0] [HEAP_SNAPSHOT=0]
 *   [COMMANDER_SEED=42] (seed 123 has no clear Lodge deployment spot on current master)
 *   [IDLE_MS=6000] (idle cycle length; IDLE-GROWTH uses 60000 for 30-minute curves)
 *
 * Run through captures/browser-slot.sh with `npx tsx --env-file=<file>`.
 */
const savePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(savePath && outputDir, "Set SAVE and OUTPUT_DIR");
const scenarios = (process.env.SCENARIOS ?? "idle,scout,commander,zoom,buildings,tone,detail,island").split(",");
const quality = process.env.QUALITY ?? "high";
const cycles = Number(process.env.CYCLES ?? 20);
const warmup = Number(process.env.WARMUP ?? 2);
const shots = process.env.SHOTS !== "0";
/** TRACE=1: group the buffers still live after the cycles by creating object (diagnosis only). */
const trace = process.env.TRACE === "1";
/** HEAP_SNAPSHOT=1: write `<quality>-<scenario>.heapsnapshot` after the cycles (retainer analysis). */
const heapSnapshot = process.env.HEAP_SNAPSHOT === "1";
const idleMs = Number(process.env.IDLE_MS ?? 6000);
const [width, height] = (process.env.VIEWPORT ?? "1280x800").split("x").map(Number);
const LOAD_TIMEOUT_MS = 300_000;
const commanderSeed = process.env.COMMANDER_SEED ?? "42";
const homeSave = JSON.parse(readFileSync(savePath, "utf8")) as Record<string, unknown>;
mkdirSync(outputDir, { recursive: true });

interface Scenario {
  colony?: boolean;
  /** Generated admin map instead of the owner save (the owner Lodge has no clear deployment spot). */
  generatedMap?: boolean;
  prepare?: (page: Page) => Promise<void>;
  /** `shot` captures the possessed view (last cycle only, for the before/after spot check). */
  run: (page: Page, cycle: number, shot: (label: string) => Promise<void>) => Promise<void>;
}

const waitIsland = (page: Page) => page.waitForFunction(() => (window as any).__islandReady === true &&
  !document.querySelector("#loading-screen"), null, { timeout: LOAD_TIMEOUT_MS });

/** A page handoff (island travel or graphics refresh) has landed when a new receipt exists. */
const waitHandoff = async (page: Page, before: number) => {
  await page.waitForFunction(count => ((window as any).__handoffReceipts?.().length ?? 0) > count, before,
    { timeout: LOAD_TIMEOUT_MS });
  await waitIsland(page);
};

const receiptCount = (page: Page) => page.evaluate(() => (window as any).__handoffReceipts?.().length ?? 0);

/** Retries the entry request: an entry asked during a late return transition can be refused. */
const enterScout = async (page: Page) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.evaluate(() => (window as any).__exploration.controller.enter());
    const entered = await page.waitForFunction(() => (window as any).__exploration.controller.phase() ===
      "possessed", null, { timeout: 10000 }).then(() => true, () => false);
    if (entered) return;
  }
  const phase = await page.evaluate(() => (window as any).__exploration.controller.phase());
  throw new Error(`Scout entry did not finish (phase ${phase})`);
};

const leaveScout = async (page: Page) => {
  await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().leaveUnlockInMs === 0,
    null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__exploration.controller.requestLeave("leave"));
  await page.waitForFunction(() => (window as any).__exploration.controller.phase() === "idle", null,
    { timeout: 30000 });
};

const enterCommander = async (page: Page) => {
  await page.getByRole("button", { exact: true, name: "Control commander" }).click();
  await page.waitForFunction(() => (window as any).__commanderControl.controller.active(), null,
    { timeout: 60000 });
};

const leaveCommander = async (page: Page) => {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !(window as any).__commanderControl.owns(), null, { timeout: 30000 });
};

const focusHome = (page: Page, zoom: number) => page.evaluate(level => {
  const live = (window as any).__settlement;
  const home = live.simulation.headquarters;
  live.focusGround(home.x, home.z, level);
}, zoom);

/**
 * Buildings raised and demolished per `buildings` cycle: the first three types the save does not
 * already have that the debug raiser can place (it allows one per type), then the same each cycle.
 */
let cycledBuildingTypes: number[] | undefined;
/** Types never cycled: headquarters, Military Academy, Commander's Lodge (soldiers, single sites). */
const EXCLUDED_BUILDING_TYPES = [0, 40, 62];
const MAX_BUILDING_TYPE = 70;

const raiseBuildings = async (page: Page) => {
  const raised = await page.evaluate(({ excluded, maximum, types }) => {
    const sim = (window as any).__settlement.simulation;
    const candidates = types ?? Array.from({ length: maximum }, (_, index) => index + 1)
      .filter(type => !excluded.includes(type));
    const result: Array<{ type: number; uid: number; x: number; z: number }> = [];
    for (const type of candidates) {
      if (result.length === 3) break;
      const built = sim.debugRaiseBuilding(type);
      if (built.ok) result.push({ type, uid: built.building.uid, x: built.building.x, z: built.building.z });
    }
    return result;
  }, { excluded: EXCLUDED_BUILDING_TYPES, maximum: MAX_BUILDING_TYPE, types: cycledBuildingTypes });
  cycledBuildingTypes ??= raised.map(building => building.type);
  return raised;
};

const demolishBuildings = (page: Page, uids: number[]) => page.evaluate(list => {
  const sim = (window as any).__settlement.simulation;
  for (const uid of list) sim.demolishBuilding(uid);
}, uids);

const focusGround = (page: Page, x: number, z: number, zoom: number) => page.evaluate(([px, pz, level]) =>
  (window as any).__settlement.focusGround(px, pz, level), [x, z, zoom] as const);

const TONES = ["vivid", "filmic", "auto"];
const DETAILS: Array<[string, Record<string, string>]> = [
  ["minimal", {}], [quality, { bloom: "off" }], [quality, {}]
];

const openTracker = async (page: Page) => {
  await page.locator(".colony-tracker").waitFor({ state: "visible", timeout: 30_000 });
  if (await page.locator(".colony-tracker__body").isHidden()) await page.locator(".colony-tracker__handle").click();
};

const travel = async (page: Page, click: () => Promise<void>) => {
  const before = await receiptCount(page);
  await openTracker(page);
  await click();
  await waitHandoff(page, before);
};

const SCENARIOS: Record<string, Scenario> = {
  /** R16a parked variants: both recipes resident (close + far view), then the buildings go. */
  buildings: {
    run: async page => {
      const raised = await raiseBuildings(page);
      if (!raised.length) throw new Error("No cycled building could be raised");
      for (const zoom of [3, 0.3, 3]) {
        await focusGround(page, raised[0]!.x, raised[0]!.z, zoom);
        await page.waitForTimeout(2500);
      }
      await demolishBuildings(page, raised.map(building => building.uid));
      await page.waitForTimeout(3000);
    }
  },
  commander: {
    generatedMap: true,
    prepare: async page => {
      await recruitCommander(page);
      await page.waitForTimeout(1500);
      await deployCommander(page);
      await waitCommanderInField(page);
    },
    run: async (page, cycle, shot) => {
      await enterCommander(page);
      await page.waitForTimeout(1200);
      if (cycle === warmup + cycles - 1) await shot("possessed");
      await leaveCommander(page);
      await page.waitForTimeout(3500);
    }
  },
  detail: {
    run: async page => {
      for (const [level, overrides] of DETAILS) {
        const before = await receiptCount(page);
        await page.evaluate(([name, values]) => (window as any).__graphicsReview.applyDetail(name, values),
          [level, overrides] as const);
        await waitHandoff(page, before);
        await page.waitForTimeout(1500);
      }
    }
  },
  /** Control: the same live island for the same time without a switch (simulation-driven growth). */
  idle: { run: page => page.waitForTimeout(idleMs) },
  island: {
    colony: true,
    run: async page => {
      await travel(page, () => page.getByRole("button", { name: "Return to the home island" }).click());
      await page.waitForTimeout(1500);
      await travel(page, () => page.locator("[data-colony-visit]").first().click());
      await page.waitForTimeout(1500);
    }
  },
  scout: {
    run: async (page, cycle, shot) => {
      await enterScout(page);
      await page.waitForTimeout(1200);
      if (cycle === warmup + cycles - 1) await shot("possessed");
      await leaveScout(page);
      await page.waitForTimeout(3500);
    }
  },
  tone: {
    run: async page => {
      for (const tone of TONES) {
        await page.evaluate(name => (window as any).__gpuLifecycle.api.setColorTone(name), tone);
        await page.waitForTimeout(700);
      }
    }
  },
  zoom: {
    run: async page => {
      for (const zoom of [0.05, 3, 1]) {
        await focusHome(page, zoom);
        await page.waitForTimeout(2500);
      }
    }
  }
};

const stagedSave = (colony: boolean) => JSON.stringify(colony ? prepareColonyFixture(homeSave).save
  : { ...homeSave, savedAt: Date.now() });

const openPage = async (browser: Browser, url: string, scenario: Scenario) => {
  const context = await browser.newContext({ deviceScaleFactor: 1, viewport: { height: height!, width: width! } });
  await context.addInitScript("window.__name = value => value");
  const page = await context.newPage();
  await installGpuLifecycleProbe(context, page, trace);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`pageerror ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !/404|favicon/.test(message.text())) errors.push(message.text().slice(0, 300));
  });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  if (scenario.generatedMap) {
    await page.addInitScript(level => localStorage.setItem("island-of-settlers.graphics.detail", level), quality);
    await page.goto(`${url}admin.html?seed=${commanderSeed}&size=96&forest=0&cache=0&time=day&passes=1`);
  } else {
    await stageStartupSave(page, url, stagedSave(Boolean(scenario.colony)));
    await page.goto(`${url}?quality=${quality}&cache=0&login=1`);
  }
  await waitIsland(page);
  const cdp = await context.newCDPSession(page);
  return { cdp, context, errors, page };
};

const runScenario = async (browser: Browser, url: string, name: string) => {
  const scenario = SCENARIOS[name];
  assert(scenario, `Unknown scenario ${name}`);
  const { cdp, context, errors, page } = await openPage(browser, url, scenario);
  const samples: LifecycleSample[] = [];
  const report = { cycles, errors, name, quality, samples, warmup };
  const save = () => writeFileSync(resolve(outputDir, `${quality}-${name}.json`), JSON.stringify(report, null, 2));
  const shot = async (label: string) => {
    if (shots) await page.screenshot({ path: resolve(outputDir, `${quality}-${name}-${label}.png`) });
  };
  try {
    await page.waitForTimeout(3000);
    await scenario.prepare?.(page);
    samples.push(await sampleLifecycle(page, cdp as CDPSession, "loaded"));
    await shot("loaded");
    for (let cycle = 0; cycle < warmup + cycles; cycle++) {
      if (trace && cycle === warmup) await page.evaluate(() => (window as any).__gpuLifecycle.mark());
      if (heapSnapshot && cycle === warmup)
        await writeHeapSnapshot(cdp, resolve(outputDir, `${quality}-${name}-warm.heapsnapshot`));
      if (trace && cycle === warmup + Math.floor(cycles / 2)) Object.assign(report, {
        midBufferTags: await page.evaluate(() => (window as any).__gpuLifecycle.tagsSinceMark())
      });
      await scenario.run(page, cycle, shot);
      samples.push(await sampleLifecycle(page, cdp, cycle < warmup ? `warmup-${cycle}` : `cycle-${cycle - warmup}`));
      save();
      console.log(name, JSON.stringify(summaryRow(samples.at(-1)!)));
    }
    await shot("final");
    if (heapSnapshot) await writeHeapSnapshot(cdp, resolve(outputDir, `${quality}-${name}.heapsnapshot`));
    Object.assign(report, {
      globalListenerSites: await page.evaluate(() => (window as any).__gpuLifecycle.globalListenerSites())
    });
    if (trace) Object.assign(report, {
      liveBufferTags: await page.evaluate(() => (window as any).__gpuLifecycle.tagsSinceMark())
    });
  } finally {
    save();
    await context.close();
  }
};

/** Compact console row: the counters that must plateau. */
const summaryRow = (sample: LifecycleSample) => {
  const { gl, heapUsedMb, label, listeners, three } = sample as any;
  return { heapUsedMb, label, gl, listeners: { ...listeners, byType: undefined }, three };
};

const { server, url } = await startDevServer({ env: { VITE_API_URL: "", VITE_IDENTITY_URL: "" } });
const browser = await launchBrowser();
try {
  for (const name of scenarios) await runScenario(browser, url, name);
} finally {
  await browser.close();
  await server.close();
}
