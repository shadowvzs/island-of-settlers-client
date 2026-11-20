import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import {
  gameErrors, lookAt, openFreshIsland, trackPageErrors
} from "./expedition-review-helpers";
import { openColony, stageRaidShip } from "./raid-ship-stage";
import { resourcesPath } from "./resources-path";

/**
 * Native review of the battle AI visuals (docs/archive/dated/battle-ai-plan-2026-10-12.md "Implementation"), High
 * and Minimal: a mixed group gathered at the rally banner (foot block, archers behind, riders on the
 * flanks), soldiers passing through workers with the visual side step, and on a test colony a rider
 * dismounted at a besieged door with its horse waiting beside it, and a hard-difficulty raid ship
 * sailing in with its troops on deck, its gangway out and the troops landing. The simulation is frozen for each screenshot.
 * Run: `npx tsx tools/bench/battle-ai-review.ts` (QUALITIES=minimal limits it).
 */
const output = resourcesPath("settlement-previews", "battle-ai");
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
type Page = import("playwright-core").Page;
type Point = { x: number; z: number };
const report: Record<string, unknown> = {};
let stage = "start";

const advance = (page: Page, seconds: number) => page.evaluate(seconds => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
}, seconds);
/** Stops (or resumes) the simulation clock while the renderer keeps drawing. */
const freeze = (page: Page, frozen: boolean) => page.evaluate(frozen => {
  const simulation = (window as any).__settlement.simulation;
  simulation.__update ??= simulation.update;
  simulation.update = frozen ? () => undefined : simulation.__update;
}, frozen);
/** Close and gameplay views of `point`, simulation frozen. */
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

/** Open walkable ground 10-30 tiles from the headquarters, clear of buildings. */
const openGround = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation, { access } = simulation.headquarters;
  for (let radius = 10; radius <= 30; radius += 2) for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8;
    const point = { x: Math.round(access.x + Math.cos(angle) * radius) + .5, z: Math.round(access.z + Math.sin(angle) * radius) + .5 };
    let clear = true;
    for (let dz = -5; dz <= 5 && clear; dz++) for (let dx = -5; dx <= 5 && clear; dx++)
      clear = !simulation.isOccupied(point.x + dx, point.z + dz);
    if (clear && simulation.plantMilitaryRally(point)) return point;
  }
  return null;
});

const reviewRally = async (page: Page, quality: string) => {
  stage = "rally";
  await page.evaluate(() => (window as any).__settlement.simulation.receiveTroops([
    ...Array.from({ length: 24 }, (_, index) => ({ hp: 125, rank: 0, type: index % 3 ? "shield" : "heavy" })),
    ...Array.from({ length: 8 }, () => ({ hp: 56.25, rank: 0, type: "archer" })),
    ...Array.from({ length: 8 }, () => ({ hp: 105, rank: 0, type: "cavalry" }))]));
  const point = await openGround(page);
  assert(point, "open ground for the rally banner");
  const called = await page.evaluate(point => (window as any).__settlement.simulation
    .callOutMilitary(["shield", "heavy", "archer", "cavalry"], point), point);
  await advance(page, 150);
  const spread = await page.evaluate(point => {
    const simulation = (window as any).__settlement.simulation;
    const bodies = simulation.frames().filter((actor: any) => actor.job === "Soldier" && actor.phase === "militaryField");
    return Math.max(...bodies.map((actor: any) => Math.hypot(actor.x - point.x, actor.z - point.z)));
  }, point);
  report[`${quality}-rally`] = { called, spread };
  await shoot(page, quality, "1-rally-formation", point);
};

/** Soldiers ordered onto a busy worker: the moment they overlap, the figures step aside. */
const reviewSideStep = async (page: Page, quality: string) => {
  stage = "side step";
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const home = simulation.headquarters;
    for (const dx of [8, -8, 10, -10]) {
      const placed = simulation.placeBuilding(17, home.x + dx, home.z);
      if (!placed.ok) continue;
      Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {}, output: { logs: 5 } });
      simulation.connectRoads(home.access, placed.building.access);
      break;
    }
    return true;
  });
  const contact = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const soldiers = simulation.militarySoldiers().filter((soldier: any) => soldier.combat?.type === "shield")
      .slice(0, 6).map((soldier: any) => soldier.actor);
    for (let attempt = 0; attempt < 60; attempt++) {
      const worker = simulation.frames().find((actor: any) => actor.visible && actor.job !== "Soldier" && actor.job !== "Mount" &&
        ["walk", "carry"].includes(actor.action));
      if (worker) simulation.commandMilitary(soldiers, { x: worker.x, z: worker.z }, "move");
      for (let tick = 0; tick < 20; tick++) {
        simulation.update(.05);
        const bodies = simulation.frames().filter((actor: any) => soldiers.includes(actor.uid));
        const civilian = simulation.frames().find((actor: any) => actor.visible && actor.job !== "Soldier" &&
          actor.job !== "Mount" && bodies.some((body: any) => Math.hypot(body.x - actor.x, body.z - actor.z) < .3));
        if (civilian) return { x: civilian.x, z: civilian.z };
      }
    }
    return null;
  });
  report[`${quality}-side-step`] = contact;
  assert(contact, "a moving worker meeting the soldiers");
  await shoot(page, quality, "2-soldier-worker-side-step", contact);
};

/** On the test colony: riders and foot besiege the nearest fort; a rider gets down at the door. */
const reviewDismount = async (page: Page, quality: string) => {
  stage = "dismount";
  const rider = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation, home = simulation.home();
    const fort = simulation.buildings().filter((building: any) => building.militaryFaction > 0)
      .sort((a: any, b: any) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
    const saved = simulation.saveState();
    const guards = saved.military.soldiers.filter((soldier: any) => soldier.building === fort.uid).slice(0, 2);
    const keep = new Set(guards.map((soldier: any) => soldier.actor));
    const removed = new Set(saved.military.soldiers.filter((soldier: any) =>
      soldier.combat?.faction > 0 && !keep.has(soldier.actor)).flatMap((soldier: any) =>
      [soldier.actor, soldier.combat?.mount]));
    saved.military.soldiers = saved.military.soldiers.filter((soldier: any) => !removed.has(soldier.actor));
    saved.actors = saved.actors.filter((actor: any) => !removed.has(actor.uid));
    for (const guard of guards) {
      guard.rank = 0; guard.combat.type = "shield"; guard.combat.hp = 125;
      saved.actors.find((actor: any) => actor.uid === guard.actor).tool = "sword";
    }
    const door = saved.military.combat.doors.find((entry: any) => entry.building === fort.uid);
    door.hp = door.maximum = 200;
    if (!simulation.loadState(saved).ok) throw new Error("dismount fixture");
    let id: number | null = null;
    for (const radius of [4, 5, 6, 7, 8]) for (let step = 0; step < 16 && id === null; step++)
      id = simulation.spawnMilitaryOpponent({ x: fort.access.x + Math.cos(step * Math.PI / 8) * radius,
        z: fort.access.z + Math.sin(step * Math.PI / 8) * radius }, "cavalry", 2, 2);
    if (id === null) throw new Error("mounted ground near the fort");
    const riderSave = simulation.saveState();
    riderSave.military.soldiers.find((soldier: any) => soldier.actor === id).combat.faction = 0;
    if (!simulation.loadState(riderSave).ok) throw new Error("friendly dismount fixture");
    if (!simulation.siegeMilitary([id], fort.uid)) throw new Error("rider siege order refused");
    // A door facing the shore keeps the horse at the nearest open front (up to ~5 tiles out): the rider
    // gets down there and walks on. The shot waits until our rider stands at the door on foot, and
    // frames it with its waiting horse (the moment of getting down shows rider and horse as one).
    for (let tick = 0; tick < 20 * 400; tick++) {
      simulation.update(.05);
      const down = simulation.militarySoldiers()
        .find((soldier: any) => soldier.actor === id && soldier.combat?.dismounted);
      const body = down && simulation.frames().find((actor: any) => actor.uid === id);
      const horse = down && simulation.frames().find((actor: any) => actor.uid === down.combat.mount);
      if (!body || Math.hypot(body.x - fort.access.x, body.z - fort.access.z) > 1.6) continue;
      return { x: horse ? (body.x + horse.x) / 2 : body.x, z: horse ? (body.z + horse.z) / 2 : body.z };
    }
    return { failed: true, soldier: simulation.militarySoldiers().find((soldier: any) => soldier.actor === id),
      body: simulation.frames().find((actor: any) => actor.uid === id), fort: fort.access };
  });
  if (rider && "failed" in rider) {
    console.log(JSON.stringify(rider));
    throw new Error("rider never stood at the door on foot");
  }
  report[`${quality}-dismount`] = rider;
  assert(rider, "rider dismounts at the door");
  await shoot(page, quality, "3-dismounted-rider-at-door", rider);
};

/** Turns the test colony hard, hands the player the nearest fort, and waits for the raid ship. */
const reviewRaidShip = async (page: Page, quality: string) => {
  stage = "raid ship";
  const failed = await stageRaidShip(page);
  assert(!failed, `raid ship fixture: ${failed}`);
  const ship = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    // Mid-approach: the galley under sail, its troops standing on deck.
    let first: { x: number; z: number } | undefined;
    for (let tick = 0; tick < 20 * 200; tick++) {
      simulation.update(.05);
      const raid = simulation.shipFrames().find((frame: any) => frame.livery === "enemy");
      const deck = simulation.frames().filter((actor: any) => actor.phase === "adventureAboard" && actor.visible);
      if (raid?.phase !== "sailing" || !deck.length) continue;
      first ??= { x: raid.x, z: raid.z };
      if (Math.hypot(raid.x - first.x, raid.z - first.z) >= 4)
        return { x: raid.x, z: raid.z, deck: deck.length, sailed: Math.hypot(raid.x - first.x, raid.z - first.z) };
    }
    return { error: "No ship sailing in", colony: simulation.saveState().colony };
  });
  report[`${quality}-raid-ship`] = ship;
  assert(ship && !("error" in ship), `raid ship sails in with troops on deck: ${JSON.stringify(ship)}`);
  await shoot(page, quality, "4-raid-ship-sailing-deck", ship);
  const dock = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 20 * 60; tick++) {
      const raid = simulation.shipFrames().find((frame: any) => frame.livery === "enemy");
      const site = raid && simulation.shipSites().find((entry: any) => entry.id === raid.id);
      if (site?.workPier) return site;
      simulation.update(.05);
    }
    return null;
  });
  assert(dock?.workPier, "arrived raid ship deploys its gangway");
  await shoot(page, quality, "5-raid-ship-gangway", dock);
  // The first troops down the gangway and ashore.
  await advance(page, 4);
  await shoot(page, quality, "6-raid-ship-landing", dock.workPier.shore);
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  for (const quality of qualities) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = trackPageErrors(page, () => stage);
    await openFreshIsland(page, url, quality);
    if (!process.env.RAID_ONLY) {
      console.log(quality, "rally");
      await reviewRally(page, quality);
      console.log(quality, "side step");
      await reviewSideStep(page, quality);
      stage = "colony"; console.log(quality, stage);
      await openColony(page, url, quality);
      console.log(quality, "dismount");
      await reviewDismount(page, quality);
    }
    console.log(quality, "raid ship");
    await openColony(page, url, quality, "hard");
    await reviewRaidShip(page, quality);
    report[`${quality}-errors`] = gameErrors(errors);
    await page.close();
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
