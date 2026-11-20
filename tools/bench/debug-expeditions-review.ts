import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import {
  gameErrors, lookAt, openFreshIsland, openPopup, reloadIsland, runDevelopmentTool, sailUntilLanded,
  statusMessages, trackPageErrors, visitIsland
} from "./expedition-review-helpers";
import { besiegeForts, fightFieldBattle, queueAtFortDoor } from "./island-battle-helpers";

/**
 * Native review of the development menu "Test adventure" and "Test colony expedition" on a fresh
 * island: every grant (harbour, ships, troops, crew, supplies), the 5 s voyages, the first visit
 * (adventure: gangway landing on an island without buildings; colony: harbour, ore, garrisoned
 * forts), the battle, the victory popups, the adventure reward ship and the 20 s colony ore ship.
 * Run: `npx tsx tools/bench/debug-expeditions-review.ts` (QUALITY=high for the full preset).
 */
const QUALITY = process.env.QUALITY ?? "minimal";
const output = resolve(process.env.OUTPUT ?? "../resources/settlement-previews/debug-expeditions");
mkdirSync(output, { recursive: true });
type Page = import("playwright-core").Page;

const report: Record<string, unknown> = { quality: QUALITY };
/** Review step, recorded with every page error. */
let stage = "start";
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: resolve(output, `${QUALITY}-${name}.png`) });
};
/** The first visiting ship (reward or ore ship) once one sails in, or null after `timeout` ms. */
const visitorShip = async (page: Page, timeout: number) => {
  const handle = await page.waitForFunction(() => {
    const ship = (window as any).__settlement?.simulation.ships().find((entry: any) => entry.visitor);
    return ship && { name: ship.name, phase: ship.phase, x: ship.x, z: ship.z };
  }, null, { polling: 250, timeout }).catch(() => null);
  return handle ? await handle.jsonValue() as { name: string; phase: string; x: number; z: number } : null;
};

/** Close views of the attackers waiting under the walls at the first fort's door. */
const shootSiegeQueue = async (page: Page, name: string) => {
  const queue = await queueAtFortDoor(page);
  assert(queue, "A hostile fort must stand after the field battle");
  await lookAt(page, queue.door);
  await page.mouse.move(640, 430);
  await page.mouse.wheel(0, -900);
  await shot(page, `${name}-close`);
  await page.mouse.wheel(0, 500);
  await shot(page, name);
  return queue;
};

/** What the first visit found: map side, buildings, the home, enemy forts and camps, ore and the landing. */
const islandLayout = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const hostile = simulation.militarySoldiers().filter((soldier: any) => soldier.combat?.faction > 0);
  const landing = simulation.adventure()?.landing;
  const body = (soldier: any) => simulation.frames().find((actor: any) => actor.uid === soldier.actor);
  const distances = landing ? hostile.map((soldier: any) => Math.hypot(body(soldier).x - landing.shore.x,
    body(soldier).z - landing.shore.z)) : [];
  return { buildings: simulation.buildings().length, campSoldiers: hostile.filter((soldier: any) =>
    !soldier.stationed).length, docks: simulation.shipSites().filter((site: any) => site.kind === "dock").length,
  forts: simulation.buildings().filter((building: any) => building.militaryFaction > 0).length,
  garrisoned: hostile.filter((soldier: any) => soldier.stationed).length, home: simulation.home()?.typeId ?? null,
  landing, nearestEnemy: distances.length ? Math.round(Math.min(...distances)) : null,
  oreZones: simulation.surveyedDeposits().filter((zone: any) => zone.ore && zone.surveyed).length,
  side: Math.sqrt(simulation.territory().owned.length) };
});

/** Close and gameplay views of the troops walking down the gangway from the anchored ship. */
const shootLanding = async (page: Page, shore: { x: number; z: number }) => {
  await lookAt(page, shore);
  await page.mouse.move(640, 430);
  await page.mouse.wheel(0, -900);
  await shot(page, "3-adventure-gangway-close");
  await page.mouse.wheel(0, 500);
  await shot(page, "3a-adventure-gangway");
  return page.evaluate(() => (window as any).__settlement.simulation.militarySoldiers()
    .filter((soldier: any) => !soldier.combat?.faction)
    .map((soldier: any) => (window as any).__settlement.simulation.frames()
      .find((actor: any) => actor.uid === soldier.actor)?.phase)
    .reduce((counts: Record<string, number>, phase: string) => ({ ...counts, [phase]: (counts[phase] ?? 0) + 1 }),
      {}));
};

/** Fights the camps, takes every fort by siege, then mops up released defenders. */
const winIsland = async (page: Page, key: string, queueShot: string) => {
  const camps = await fightFieldBattle(page);
  const queue = await shootSiegeQueue(page, queueShot);
  const siege = await besiegeForts(page);
  const cleanup = await fightFieldBattle(page, 600);
  report[key] = { camps, cleanup, queue, siege };
  return siege;
};

const reviewAdventure = async (page: Page) => {
  report.adventureStart = await runDevelopmentTool(page, "Test adventure",
    suffix => shot(page, `1-adventure-started${suffix}`));
  const harbour = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const building = simulation.buildings().find((entry: any) => entry.typeId === 39);
    return { construction: building?.construction, ships: simulation.ships().length, uid: building?.uid,
      x: building?.x, z: building?.z };
  });
  report.harbour = harbour;
  assert.equal(harbour.construction, 1, "The test must raise a finished harbour");
  await page.waitForTimeout(4000);
  await shot(page, "2-adventure-boarding");
  const landed = await sailUntilLanded(page);
  report.adventureLanded = landed;
  assert.equal(landed.status, "arrived");
  assert.equal(landed.island.debug, true);
  stage = "adventure island";
  await visitIsland(page, "[data-adventure-visit]");
  const layout = await islandLayout(page);
  report.adventureIsland = layout;
  assert.equal(layout.side, 96);
  assert.equal(layout.buildings, 0, "An adventure island has no buildings");
  assert.equal(layout.home, null);
  assert.equal(layout.docks, 1, "The landing ship puts out a gangway");
  assert(layout.campSoldiers > 0 && layout.garrisoned === 0, "Only field enemies hold an adventure island");
  report.adventureLandingPhases = await shootLanding(page, layout.landing.shore);
  await shot(page, "3b-adventure-arrival");
  // An open land fight: the camps are the whole enemy.
  report.adventureBattle = await fightFieldBattle(page);
  const won = await openPopup(page, "Sail home");
  report.adventurePopup = won.text;
  assert.match(won.text, /Adventure won!/);
  await shot(page, "4-adventure-won");
  await reloadIsland(page, () => won.button.click());
  stage = "adventure home";
  const reward = await visitorShip(page, 20000);
  assert(reward, "The reward ship must sail to the home harbour");
  report.rewardMessage = await statusMessages(page);
  await lookAt(page, reward);
  await shot(page, "5-adventure-reward-ship");
  assert.equal(reward.name, "Reward ship");
  report.rewardUnloaded = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const harbour = simulation.buildings().find((entry: any) => entry.typeId === 39);
    for (let second = 0; second < 400 && simulation.ships().some((ship: any) => ship.visitor); second++)
      simulation.update(1);
    return { coins: harbour.inventory.coins ?? 0, planks: harbour.inventory.planks ?? 0 };
  });
};

const reviewColony = async (page: Page) => {
  stage = "colony start";
  report.colonyStart = await runDevelopmentTool(page, "Test colony expedition",
    suffix => shot(page, `6-colony-started${suffix}`));
  const landed = await sailUntilLanded(page);
  report.colonyLanded = landed;
  assert.equal(landed.status, "arrived");
  stage = "colony island";
  await visitIsland(page, "[data-colony-visit]");
  const layout = await islandLayout(page);
  report.colonyIsland = layout;
  assert.equal(layout.side, 96);
  assert.equal(layout.home, 39, "A colony starts from its pre-built harbour");
  assert(layout.forts > 0 && layout.garrisoned > 0, "Garrisoned enemy forts hold a colony island");
  assert(layout.oreZones > 0, "A colony island has ore for its mines");
  await shot(page, "7-colony-arrival");
  await winIsland(page, "colonyBattle", "7b-colony-siege-queue");
  const conquered = await openPopup(page, "Stay and build");
  report.colonyPopup = conquered.text;
  assert.match(conquered.text, /conquered/i);
  await shot(page, "8-colony-conquered");
  await conquered.button.click();
  // The test colony's ore ship calls every 20 s of wall-clock time.
  const oreShip = await visitorShip(page, 30000);
  report.colonyOreShip = oreShip;
  assert.equal(oreShip?.name, "Ore ship");
  assert(oreShip, "The test colony's ore ship must call within 20 s");
  await lookAt(page, oreShip);
  await shot(page, "9-colony-ore-ship");
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = trackPageErrors(page, () => stage);
  report.errors = errors;
  await openFreshIsland(page, url, QUALITY);
  await reviewAdventure(page);
  await reviewColony(page);
  assert.deepEqual(gameErrors(errors), []);
} finally {
  writeFileSync(resolve(output, `${QUALITY}-review.json`), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report, null, 1).slice(0, 4000));
