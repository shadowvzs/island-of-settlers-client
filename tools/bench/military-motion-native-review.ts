import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { gameErrors, lookAt, openFreshIsland, trackPageErrors } from "./expedition-review-helpers";
import { resourcesPath } from "./resources-path";

/**
 * Native review of military motion (docs/archive/dated/military-motion-2026-10-13.md), High and Minimal: two mixed
 * computer armies (blue and red) meet on open ground next to the headquarters; screenshots of the
 * approach, the front line and the melee, close and at gameplay distance, simulation frozen.
 * Run: `npx tsx tools/bench/military-motion-native-review.ts` (QUALITIES=minimal limits it).
 */
type Page = import("playwright-core").Page;
type Point = { x: number; z: number };
const output = resourcesPath("settlement-previews", "military-motion", "native");
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const report: Record<string, unknown> = {};
let stage = "start";

const freeze = (page: Page, frozen: boolean) => page.evaluate(frozen => {
  const simulation = (window as any).__settlement.simulation;
  simulation.__update ??= simulation.update;
  simulation.update = frozen ? () => undefined : simulation.__update;
}, frozen);
const advance = (page: Page, seconds: number) => page.evaluate(seconds => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < seconds * 20; tick++) (simulation.__update ?? simulation.update)(.05);
}, seconds);
const shoot = async (page: Page, quality: string, name: string, point: Point) => {
  await freeze(page, true);
  await lookAt(page, point);
  await page.mouse.move(640, 430);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: resolve(output, `${quality}-${name}-close.png`) });
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(output, `${quality}-${name}.png`) });
  await freeze(page, false);
};

/** Two 24-soldier armies (foot block, archers behind, riders on the wings) 20 tiles apart. */
const stageBattle = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation, { access } = simulation.headquarters;
  const open = (x: number, z: number) => {
    for (let dz = -8; dz <= 8; dz++) for (let dx = -14; dx <= 14; dx++)
      if (simulation.isOccupied(x + dx, z + dz)) return false;
    return true;
  };
  let centre: Point | null = null;
  const spawn = (faction: number, facing: number) => {
    const ids: number[] = [];
    const types = ["shield", "shield", "heavy", "shield", "shield", "heavy"];
    const put = (x: number, z: number, type: string) => {
      const id = simulation.spawnMilitaryOpponent({ x, z }, type, 0, faction);
      if (id !== null) ids.push(id);
    };
    for (let index = 0; index < 18; index++)
      put(centre!.x - facing * (8 + Math.floor(index / 6) * .9), centre!.z + (index % 6 - 2.5) * .9, types[index % 6]!);
    for (let index = 0; index < 4; index++) put(centre!.x - facing * 11.5, centre!.z + (index - 1.5) * 1.1, "archer");
    for (const side of [-1, 1]) put(centre!.x - facing * 9, centre!.z + side * 5, "cavalry");
    return ids;
  };
  const baseline = simulation.saveState();
  let blue: number[] = [], red: number[] = [];
  for (let radius = 14; radius <= 40 && !centre; radius += 2) for (let step = 0; step < 16 && !centre; step++) {
    const angle = step * Math.PI / 8;
    const x = Math.round(access.x + Math.cos(angle) * radius) + .5, z = Math.round(access.z + Math.sin(angle) * radius) + .5;
    if (!open(x, z)) continue;
    centre = { x, z };
    blue = spawn(1, 1); red = spawn(2, -1);
    if (blue.length === 24 && red.length === 24) break;
    if (!simulation.loadState(baseline).ok) throw new Error("Battle fixture baseline restore failed");
    centre = null;
  }
  if (!centre) return null;
  simulation.commandMilitaryOpponent(blue, { x: centre.x + 9, z: centre.z }, 1, "attackMove");
  simulation.commandMilitaryOpponent(red, { x: centre.x - 9, z: centre.z }, 2, "attackMove");
  return { blue: blue.length, centre, red: red.length };
});

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => stage);
    stage = "island"; await openFreshIsland(page, url, quality);
    stage = "battle";
    const battle = await stageBattle(page);
    if (!battle) throw new Error("No open ground for the battle");
    assert.equal(battle.blue, 24); assert.equal(battle.red, 24);
    report[`${quality}-battle`] = battle;
    await advance(page, 4);
    await shoot(page, quality, "1-approach", battle.centre);
    await advance(page, 4);
    await shoot(page, quality, "2-front", battle.centre);
    await advance(page, 6);
    await shoot(page, quality, "3-melee", battle.centre);
    report[`${quality}-errors`] = gameErrors(errors);
    assert.deepEqual(gameErrors(errors), []);
    await page.close();
  }
} finally {
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report));
