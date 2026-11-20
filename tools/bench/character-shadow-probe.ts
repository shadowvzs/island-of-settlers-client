import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";

/**
 * R02/C07 visibility probe: the C05 capture town (seed 123, "Build every building", 9 troops) in
 * iso zoom 1, iso close and (POSSESSED=1) the possessed eye at several hours. Each view is shot
 * twice in consecutive frames through an opt-in A/B switch, so the pair differs only by it:
 * PAIR=casters (default): dynamic sun casters on/off (`__probeNoCasters`), files `-on`/`-off`;
 * PAIR=fade: the owner's 0.7 shadow-map floor vs the old full baked fade
 * (`__probeLegacyShadowFade`), files `-floor`/`-legacy`.
 * Environment: OUTPUT, QUALITY (comma list), TIMES (comma list of hours, default 9,12,15.5).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITY ?? "high,medium").split(",");
const times = (process.env.TIMES ?? "9,12,15.5").split(",");
const COUNTER_KEYS = ["workerShadowCasters", "shadowCasterDrawCalls", "shadowCasterTriangles", "shadowCasterMs",
  "shadowDrawCalls", "shadowTriangles"];
const SETTLE_MS = 3500;
const PAIRS = {
  casters: { flag: "__probeNoCasters", first: "on", second: "off" },
  fade: { flag: "__probeLegacyShadowFade", first: "floor", second: "legacy" }
} as const;
const pair = PAIRS[(process.env.PAIR ?? "casters") as keyof typeof PAIRS];
assert(pair, "PAIR must be casters or fade");
const possessed = process.env.POSSESSED === "1";

const readCounters = (page: Page) => page.evaluate(keys => {
  const text = document.querySelector(".stats-overlay pre")?.textContent ?? "";
  return Object.fromEntries(keys.map(key =>
    [key, new RegExp(`${key}: (.*)`).exec(text)?.[1]?.trim() ?? null]));
}, COUNTER_KEYS);

const buildTown = (page: Page) => page.evaluate(async () => {
  const live = (window as any).__settlement;
  live.buildEveryBuilding();
  for (let wait = 0; wait < 600; wait++) {
    const status = [...document.querySelectorAll(".settlement-ui__status")].map(node => node.textContent ?? "");
    if (status.some(text => text.includes("finished building"))) break;
    await new Promise(done => setTimeout(done, 100));
  }
  const { militaryHealth } = await import(/* @vite-ignore */ String("/src/shared/settlement/military-combat-rules.ts"));
  for (let second = 0; second < 90; second++) {
    live.simulation.update(1);
    if (second % 10 === 0) await new Promise(done => setTimeout(done, 0));
  }
  live.simulation.receiveTroops([0, 1, 2].flatMap(rank => (["archer", "heavy", "shield"] as const)
    .map(type => ({ hp: militaryHealth(type, rank), rank, type }))));
  const home = live.simulation.headquarters;
  // In front of the headquarters (towards the iso camera), on open ground.
  const rally = { x: home.x + 6, z: home.z + 6 };
  live.simulation.callOutMilitary(["archer", "heavy", "shield"], rally);
  for (let second = 0; second < 60; second++) live.simulation.update(1);
  return { home: { x: home.x, z: home.z }, subject: rally };
});

/** Two consecutive frames, switch off then on (people move by a few pixels at most between them). */
const shotPair = async (page: Page, name: string) => {
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: resolve(output, `${name}-${pair.first}.png`) });
  const counters = await readCounters(page);
  await page.evaluate(flag => { (globalThis as any)[flag] = true; }, pair.flag);
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await page.screenshot({ path: resolve(output, `${name}-${pair.second}.png`) });
  await page.evaluate(flag => { (globalThis as any)[flag] = false; }, pair.flag);
  console.log(name, JSON.stringify(counters));
  return counters;
};

/** The possessed eye 9 cells south-west of the headquarters, looking at it (as in the C05 capture). */
const enterPossessed = async (page: Page, home: { x: number; z: number }) => {
  await page.locator("[data-exploration-entry]").click();
  await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().phase === "possessed",
    null, { timeout: 60_000 });
  await page.evaluate(({ x, z }) => {
    const camera = (window as any).__exploration.camera, original = camera.setPose;
    const eyeX = x - 7, eyeZ = z - 9;
    camera.setPose = (pose: any, blend: number) => original(pose ? { ...pose, x: eyeX, z: eyeZ,
      yaw: Math.atan2(x - eyeX, z - eyeZ) } : null, blend);
  }, home);
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  for (const quality of qualities) for (const time of times) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    page.on("pageerror", error => console.log(quality, time, "pageerror", error.message.slice(0, 200)));
    await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&forest=0&cache=0&time=${time}`,
      { timeout: 180_000 });
    await waitForIsland(page);
    const { home, subject } = await buildTown(page);
    await page.addStyleTag({ content: ".stats-overlay { opacity: 0 !important; pointer-events: none; }" });
    const prefix = `${quality}-t${time}`;
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 1), home);
    report[`${prefix}-iso-zoom1`] = await shotPair(page, `${prefix}-iso-zoom1`);
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 3), subject);
    report[`${prefix}-iso-close`] = await shotPair(page, `${prefix}-iso-close`);
    if (possessed) {
      await enterPossessed(page, home);
      report[`${prefix}-possessed`] = await shotPair(page, `${prefix}-possessed`);
    }
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "counters.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
