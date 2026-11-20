import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { waitForIsland } from "./expedition-review-helpers";

/**
 * C05 visual check: iso (zoom 1 and close), possessed eye and spyglass views of a fresh island after
 * "Build every building" with troops. Writes PNGs and `counters.json` (workerLods, workerDrawCalls,
 * workerTriangles read from the statistics overlay text) plus the R02/C07 sun shadow pass counters.
 * Environment: OUTPUT, QUALITY (comma list), TIME (optional hour of day, e.g. 16.5 for longer shadows).
 */
assert(process.env.OUTPUT, "Set OUTPUT");
const output = resolve(process.env.OUTPUT);
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITY ?? "high,minimal").split(",");
const timeQuery = process.env.TIME ? `&time=${process.env.TIME}` : "";
const COUNTER_KEYS = ["workerLods", "workerDrawCalls", "workerTriangles", "workerShadowCasters", "shadowDrawCalls",
  "shadowTriangles", "shadowCasterDrawCalls", "shadowCasterTriangles", "shadowCasterMs"];
const SETTLE_MS = 3500;

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
  const called = live.simulation.callOutMilitary(["archer", "heavy", "shield"], { x: home.x - 6, z: home.z - 6 });
  for (let second = 0; second < 60; second++) live.simulation.update(1);
  const snapshot = live.simulation.snapshot();
  const jobs: Record<string, number> = {};
  for (const actor of snapshot.actors) jobs[actor.job] = (jobs[actor.job] ?? 0) + 1;
  const militaryJobs = /soldier/i;
  const soldiers = snapshot.actors.filter((actor: any) => actor.visible !== false && militaryJobs.test(actor.job));
  const walkers = snapshot.actors.filter((actor: any) => actor.visible !== false);
  const subject = soldiers[0] ?? walkers.find((actor: any) => Math.hypot(actor.x - home.x, actor.z - home.z) < 14);
  return { actors: snapshot.actors.length, buildings: snapshot.buildings.length, home: { x: home.x, z: home.z },
    jobs, called, soldiers: soldiers.length, visible: walkers.length,
    subject: subject ? { job: subject.job, x: subject.x, z: subject.z } : null };
});

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
const errors: string[] = [];
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    page.on("pageerror", error => errors.push(`${quality}: ${error.message}`));
    page.on("console", message => {
      const text = message.text();
      if (message.type() !== "error" || text.startsWith("THREE.Material")) return;
      console.log(quality, "console", text.slice(0, 300));
    });
    await page.addInitScript("window.__name = value => value;");
    await page.routeWebSocket("**/*", () => {});
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    await page.goto(`${url}?quality=${quality}&seed=123&size=128&forest=0&cache=0${timeQuery}`);
    await waitForIsland(page);
    const shots: Record<string, unknown> = {};
    report[quality] = shots;
    const town = await buildTown(page);
    shots.town = town;
    console.log(quality, "town", JSON.stringify(town));
    await page.addStyleTag({ content: ".stats-overlay { opacity: 0 !important; pointer-events: none; }" });
    const shot = async (name: string) => {
      await page.waitForTimeout(SETTLE_MS);
      await page.screenshot({ path: resolve(output, `${quality}-${name}.png`) });
      shots[name] = await readCounters(page);
      console.log(quality, name, JSON.stringify(shots[name]));
    };
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 1), town.home);
    await shot("iso-zoom1");
    await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 3), town.home);
    await shot("iso-close");
    if (town.subject) {
      await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z, 2), town.subject);
      await shot("iso-subject");
    }
    await page.locator("[data-exploration-entry]").click();
    await page.waitForFunction(() => (window as any).__exploration.controller.snapshot().phase === "possessed",
      null, { timeout: 60_000 });
    // The scout spawns facing a wall: stand 9 cells south-west of the headquarters and look at it.
    await page.evaluate(({ x, z }) => {
      const camera = (window as any).__exploration.camera, original = camera.setPose;
      const eyeX = x - 7, eyeZ = z - 9;
      camera.setPose = (pose: any, blend: number) => original(pose ? { ...pose, x: eyeX, z: eyeZ,
        yaw: Math.atan2(x - eyeX, z - eyeZ) } : null, blend);
    }, town.home);
    await shot("possessed");
    await page.keyboard.press("KeyZ");
    await shot("spyglass");
    if (town.subject) {
      // Aim the raised spyglass from the same eye at the subject (a soldier when one exists).
      await page.evaluate(({ eye, subject }) => {
        const camera = (window as any).__exploration.camera, original = camera.setPose;
        camera.setPose = (pose: any, blend: number) => {
          if (!pose) return original(pose, blend);
          const dx = subject.x - eye.x, dz = subject.z - eye.z;
          return original({ ...pose, x: eye.x, z: eye.z, yaw: Math.atan2(dx, dz),
            pitch: -Math.atan2(pose.eyeHeight ?? 1.5, Math.hypot(dx, dz)) }, blend);
        };
      }, { eye: { x: town.home.x - 7, z: town.home.z - 9 }, subject: town.subject });
      await shot("spyglass-subject");
    }
    await page.close();
  }
} finally {
  report.errors = errors;
  writeFileSync(resolve(output, "counters.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
