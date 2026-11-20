import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "./browser";
import {
  gameErrors, openFreshIsland, openPopup, runDevelopmentTool, sailUntilLanded, statusMessages, trackPageErrors,
  visitIsland
} from "./expedition-review-helpers";
import { fightFieldBattle } from "./island-battle-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Native review of a colony fort's destruction (owner decision 2026-10-13, docs/contracts/colonies-and-adventures.md
 * "Colony fort destruction"): the first fort's defenders fall, every soldier attacks its walls, a new
 * fire appears at each 20 % milestone, the fallen fort burns, collapses, leaves a charred ruin and the
 * plot is cleared. Frames: `<quality>-<step>.png`, close and gameplay views.
 * Run: `npx tsx tools/bench/colony-fort-destruction-review.ts` (QUALITY=high for the full preset).
 */
const QUALITY = process.env.QUALITY ?? "minimal";
const output = resourcesPath("settlement-previews", "colony-fort-destruction");
mkdirSync(output, { recursive: true });
type Page = import("playwright-core").Page;
interface FortView { uid: number; x: number; z: number }

const CLOSE_ZOOM = 1.7, GAMEPLAY_ZOOM = 1;
const report: Record<string, unknown> = { quality: QUALITY, frames: [] };
let stage = "start";

const shot = async (page: Page, fort: FortView, name: string, both = false) => {
  await page.evaluate(({ x, z, zoom }) => (window as any).__settlement.focusGround(x, z, zoom),
    { ...fort, zoom: CLOSE_ZOOM });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/${QUALITY}-${name}.png` });
  if (!both) return;
  await page.evaluate(({ x, z, zoom }) => (window as any).__settlement.focusGround(x, z, zoom),
    { ...fort, zoom: GAMEPLAY_ZOOM });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${output}/${QUALITY}-${name}-gameplay.png` });
};

/** Besieges the hostile fort nearest the harbour until its last defender has fallen. */
const emptyFirstFort = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const home = simulation.headquarters;
  const fort = simulation.buildings().filter((building: any) => (building.militaryFaction ?? 0) > 0)
    .sort((a: any, b: any) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
  const ours = () => simulation.militarySoldiers().filter((soldier: any) =>
    (soldier.combat?.faction ?? 0) === 0 && !soldier.stationed);
  const defenders = () => simulation.militarySoldiers().filter((soldier: any) => soldier.building === fort.uid &&
    (soldier.combat?.faction ?? 0) > 0).length;
  let second = 0;
  for (; second < 2400 && defenders() > 0 && ours().length; second++) {
    const idle = ours().filter((soldier: any) => soldier.combat?.siege !== fort.uid &&
      soldier.combat?.type !== "archer");
    if (second % 5 === 0 && idle.length) simulation.siegeMilitary(idle.map((soldier: any) => soldier.actor), fort.uid);
    simulation.update(1);
  }
  return { defenders: defenders(), seconds: second, survivors: ours().length, uid: fort.uid, x: fort.x, z: fort.z };
});

/** Wall state of the fort (undefined once the plot is cleared). */
const walls = (page: Page, uid: number) => page.evaluate(id => {
  const simulation = (window as any).__settlement.simulation;
  return simulation.militaryDoors().find((door: any) => door.building === id)?.structure ?? null;
}, uid);

/** Every free soldier strikes the walls; game time runs until `done` holds (in quarter seconds). */
const attackUntil = (page: Page, uid: number, health: number) => page.evaluate(({ id, target }) => {
  const simulation = (window as any).__settlement.simulation;
  const structure = () => simulation.militaryDoors().find((door: any) => door.building === id)?.structure;
  let step = 0;
  for (; step < 4 * 600 && structure() && structure().hp / structure().maximum > target; step++) {
    if (step % 20 === 0) {
      const idle = simulation.militarySoldiers().filter((soldier: any) => (soldier.combat?.faction ?? 0) === 0 &&
        !soldier.stationed && soldier.combat?.siege !== id);
      if (idle.length && structure()?.hp > 0) simulation.siegeMilitary(idle.map((soldier: any) => soldier.actor), id);
    }
    simulation.update(.25);
  }
  return step / 4;
}, { id: uid, target: health });

/**
 * Game time runs until the fort fell `seconds` ago (or its plot is cleared, with `seconds` Infinity). The
 * live game loop also runs while screenshots are taken, so the target is a fall age, not a duration.
 */
const advanceToFallAge = (page: Page, uid: number, seconds: number) => page.evaluate(({ id, target }) => {
  const simulation = (window as any).__settlement.simulation;
  const fallen = () => simulation.militaryDoors().find((door: any) => door.building === id)?.structure?.fallen;
  for (let step = 0; step < 200 && fallen() !== undefined && fallen() < target; step++) simulation.update(.05);
}, { id: uid, target: seconds });

const record = async (page: Page, fort: FortView, name: string, extra: Record<string, unknown> = {}) => {
  (report.frames as unknown[]).push({ name, walls: await walls(page, fort.uid), ...extra });
};

const reviewDestruction = async (page: Page, fort: FortView) => {
  await shot(page, fort, "1-undefended", true);
  report.undefendedMessages = await statusMessages(page);
  const attacking = await attackUntil(page, fort.uid, .97);
  await record(page, fort, "2-attack", { seconds: attacking });
  await shot(page, fort, "2-attack", true);
  for (let milestone = 1; milestone <= 4; milestone++) {
    const seconds = await attackUntil(page, fort.uid, 1 - milestone * .2);
    await record(page, fort, `3-flame-${milestone}`, { seconds });
    await shot(page, fort, `3-flame-${milestone}`, milestone === 4);
  }
  const falling = await attackUntil(page, fort.uid, 0);
  await record(page, fort, "4-fallen", { seconds: falling });
  report.fallMessages = await statusMessages(page);
  await shot(page, fort, "4-fallen-flame-5", true);
  await advanceToFallAge(page, fort.uid, 3);
  await record(page, fort, "5-burning");
  await shot(page, fort, "5-burning");
  await advanceToFallAge(page, fort.uid, 5.5);
  await record(page, fort, "6-collapse");
  await shot(page, fort, "6-collapse");
  await advanceToFallAge(page, fort.uid, 7.2);
  await record(page, fort, "7-charred-ruin");
  await shot(page, fort, "7-charred-ruin", true);
  await advanceToFallAge(page, fort.uid, Infinity);
  await record(page, fort, "8-cleared");
  await shot(page, fort, "8-cleared", true);
  const cleared = await page.evaluate(id => !(window as any).__settlement.simulation.buildings()
    .some((building: any) => building.uid === id), fort.uid);
  assert(cleared, "The ruin is cleared and the plot freed 10 s after the fall");
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = trackPageErrors(page, () => stage);
  // Shader compile and WebGL problems are console errors, not page errors.
  const consoleErrors: string[] = [];
  report.consoleErrors = consoleErrors;
  page.on("console", message => {
    if (message.type() === "error" && stage === "destruction") consoleErrors.push(message.text().slice(0, 400));
  });
  report.errors = errors;
  await openFreshIsland(page, url, QUALITY);
  report.start = await runDevelopmentTool(page, "Test colony expedition", async () => {});
  report.landed = await sailUntilLanded(page);
  stage = "colony island";
  await visitIsland(page, "[data-colony-visit]");
  report.field = await fightFieldBattle(page);
  const fort = await emptyFirstFort(page);
  report.emptied = fort;
  assert.equal(fort.defenders, 0, "The first fort's defenders must fall");
  stage = "destruction";
  await reviewDestruction(page, fort);
  report.status = await page.evaluate(() => (window as any).__settlement.simulation.colony()?.status);
  if (report.status === "conquered") report.popup = (await openPopup(page, "Stay and build")).text;
  assert.deepEqual(gameErrors(errors), []);
} finally {
  writeFileSync(`${output}/${QUALITY}-review.json`, JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report, null, 1).slice(0, 4000));
