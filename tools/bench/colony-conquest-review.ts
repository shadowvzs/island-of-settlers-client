import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { COLONY_ECONOMY_BUILDINGS } from "../../src/shared/settlement/colony-island-rules";
import { launchBrowser, startDevServer } from "./browser";
import {
  gameErrors, lookAt, openFreshIsland, openPopup, reloadIsland, runDevelopmentTool, sailUntilLanded,
  statusMessages, trackPageErrors, visitIsland
} from "./expedition-review-helpers";
import { fightFieldBattle } from "./island-battle-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Native review of a colony conquest (docs/contracts/colonies-and-adventures.md "Colony conquest"): every
 * hostile soldier stands on ground the harbour reaches, an emptied fort is marked and destroyed
 * (owner decision 2026-10-13: colony forts are never captured), the conquest popup pays a small XP
 * reward and lets the player stay, the build menu
 * then offers the colony economy (military, mines and the miners' food chain; owner decision
 * 2026-10-13) and the colony harbour refuses demolition by its
 * own name.
 * Run: `npx tsx tools/bench/colony-conquest-review.ts` (QUALITY=high for the full preset).
 */
const QUALITY = process.env.QUALITY ?? "minimal";
const output = process.env.OUTPUT
  ? resolve(process.env.OUTPUT) : resourcesPath("settlement-previews", "colony-conquest");
mkdirSync(output, { recursive: true });
type Page = import("playwright-core").Page;

const report: Record<string, unknown> = { quality: QUALITY };
let stage = "start";
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(output, `${QUALITY}-${name}.png`) });
};

/** Owned cells, territory sources and hostile soldiers outside their forts. */
const islandState = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const territory = simulation.territory();
  return {
    fieldEnemies: simulation.militarySoldiers().filter((soldier: any) =>
      (soldier.combat?.faction ?? 0) > 0 && !soldier.stationed).length,
    owned: territory.owned.reduce((sum: number, cell: number) => sum + cell, 0),
    sources: territory.sources.map((source: any) => source.uid)
  };
});

/**
 * Attacks the first hostile fort (orders repeated for soldiers that drop out) until it is destroyed
 * and cleared, or with `untilUndefended` until its last defender has fallen.
 */
const attackFirstFort = (page: Page, untilUndefended: boolean, seconds = 2400) =>
  page.evaluate(({ limit, untilUndefended }) => {
    const simulation = (window as any).__settlement.simulation;
    const fort = simulation.buildings().find((building: any) => (building.militaryFaction ?? 0) > 0);
    if (!fort) return null;
    const attackers = () => simulation.militarySoldiers().filter((soldier: any) =>
      (soldier.combat?.faction ?? 0) === 0 && !soldier.stationed);
    const defenders = () => simulation.colony()?.fortStates.find((state: any) => state.uid === fort.uid)?.defenders;
    const gone = () => !simulation.buildings().some((building: any) => building.uid === fort.uid);
    const done = () => gone() || (untilUndefended && defenders() === 0);
    const statuses: string[] = [];
    let second = 0;
    for (; second < limit && !done(); second++) {
      const idle = attackers().filter((soldier: any) => soldier.combat?.siege !== fort.uid);
      if (second % 5 === 0 && idle.length)
        simulation.siegeMilitary(idle.map((soldier: any) => soldier.actor), fort.uid);
      if (statuses.at(-1) !== fort.status) statuses.push(fort.status);
      simulation.update(1);
    }
    statuses.push(fort.status);
    return { access: fort.access, attackers: attackers().length, destroyed: gone(), seconds: second, statuses,
      uid: fort.uid, x: fort.x, z: fort.z };
  }, { limit: seconds, untilUndefended });

/** Takes every remaining fort in turn. */
const destroyAllForts = async (page: Page) => {
  const forts = [];
  for (let fort = await attackFirstFort(page, false); fort; fort = await attackFirstFort(page, false)) {
    forts.push({ attackers: fort.attackers, destroyed: fort.destroyed, seconds: fort.seconds,
      statuses: fort.statuses.slice(-3), uid: fort.uid });
    if (!fort.destroyed) break;
  }
  return forts;
};

/**
 * Turns the sound on and counts the oscillators the victory fanfare schedules (its module shows in
 * the call stack).
 */
const countFanfareNotes = (page: Page) => page.addInitScript(() => {
  localStorage.setItem("island-of-settlers.sound", "1");
  const scope = window as unknown as { __fanfareNotes: number };
  const create = AudioContext.prototype.createOscillator;
  scope.__fanfareNotes = 0;
  AudioContext.prototype.createOscillator = function (this: AudioContext) {
    if (new Error().stack?.includes("victory-fanfare")) scope.__fanfareNotes++;
    return create.call(this);
  };
});
const fanfareNotes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fanfareNotes: number }).__fanfareNotes);

/** Opens the building panel of the given building by clicking it on screen. */
const openBuildingPanel = async (page: Page, point: { x: number; z: number }) => {
  await lookAt(page, point);
  await page.waitForTimeout(600);
  const screen = await page.evaluate(({ x, z }) => (window as any).__settlement.project(x, 2, z), point);
  await page.mouse.click(screen.x, screen.y);
  const panel = page.locator(".settlement-ui__building-details-window");
  await panel.waitFor({ state: "visible" });
  return panel;
};

/** Visible cards of every build menu tab. */
const buildMenuTabs = async (page: Page, prefix: string) => {
  await page.getByRole("button", { name: "Build", exact: true }).click();
  const tabs: Record<string, number> = {};
  for (const name of ["Small", "Medium", "Big", "Mines"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    tabs[name] = await page.locator(".settlement-ui__cards:not([hidden]) button[data-building]:not([hidden])").count();
    await shot(page, `${prefix}-build-${name.toLowerCase()}`);
  }
  await page.keyboard.press("Escape");
  return tabs;
};

const menuSize = (tabs: Record<string, number>) => Object.values(tabs).reduce((sum, count) => sum + count, 0);

/** Clicks the colony harbour, its Demolish button and the confirmation; returns the refusal message. */
const demolishHarbour = async (page: Page) => {
  const harbour = await page.evaluate(() => {
    const home = (window as any).__settlement.simulation.headquarters;
    return { x: home.x, z: home.z };
  });
  const panel = await openBuildingPanel(page, harbour);
  const demolish = panel.locator("[data-demolish-building]");
  if (!await demolish.count()) return "no demolish button";
  await demolish.click();
  await shot(page, "6-harbour-demolish");
  await page.locator("[data-demolish-confirm-yes]").click();
  await page.waitForTimeout(500);
  await shot(page, "6b-harbour-refused");
  await page.keyboard.press("Escape");
  return (await statusMessages(page)).at(-1);
};

/** The first fort down to its last defender, its marked panel, then its destruction. */
const reviewFirstDestruction = async (page: Page) => {
  const undefended = await attackFirstFort(page, true);
  assert(undefended, "A hostile fort must stand on arrival");
  report.undefended = undefended;
  await page.waitForTimeout(500);
  report.undefendedMessages = await statusMessages(page);
  await openBuildingPanel(page, undefended);
  await shot(page, "3a-fort-undefended");
  await page.keyboard.press("Escape");
  const destroyed = await attackFirstFort(page, false);
  report.firstFort = destroyed;
  await page.waitForTimeout(500);
  report.destroyMessages = await statusMessages(page);
  await lookAt(page, undefended);
  await shot(page, "3b-fort-destroyed");
};

const reviewColony = async (page: Page) => {
  report.tabsHome = await buildMenuTabs(page, "0-home");
  report.start = await runDevelopmentTool(page, "Test colony expedition", suffix => shot(page, `1-started${suffix}`));
  report.landed = await sailUntilLanded(page);
  stage = "colony island";
  await visitIsland(page, "[data-colony-visit]");
  await shot(page, "2-arrival");
  report.arrival = await islandState(page);
  report.tabsBefore = await buildMenuTabs(page, "2");
  await fightFieldBattle(page);
  await reviewFirstDestruction(page);
  report.afterFirstFort = await islandState(page);
  report.otherForts = await destroyAllForts(page);
  const conquered = await openPopup(page, "Stay and build");
  report.popup = conquered.text;
  report.fanfareNotes = await fanfareNotes(page);
  assert(Number(report.fanfareNotes) > 0, "The conquest popup plays the victory fanfare");
  await shot(page, "4-conquered-popup");
  await conquered.button.click();
  report.afterConquest = await islandState(page);
  const tabsAfter = await buildMenuTabs(page, "5");
  report.tabsAfter = tabsAfter;
  assert.equal(menuSize(tabsAfter), COLONY_ECONOMY_BUILDINGS.length, "A conquered colony offers its economy");
  report.harbourRefusal = await demolishHarbour(page);
  stage = "colony revisit";
  const sailBack = page.getByRole("button", { exact: true, name: "Return to the home island" });
  await reloadIsland(page, () => sailBack.click());
  await visitIsland(page, "[data-colony-visit]");
  report.tabsAfterRevisit = await buildMenuTabs(page, "7-revisit");
  assert.deepEqual(report.tabsAfterRevisit, report.tabsAfter);
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = trackPageErrors(page, () => stage);
  report.errors = errors;
  await countFanfareNotes(page);
  await openFreshIsland(page, url, QUALITY);
  await reviewColony(page);
  assert.deepEqual(gameErrors(errors), []);
} finally {
  writeFileSync(resolve(output, `${QUALITY}-review.json`), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report, null, 1).slice(0, 5000));
