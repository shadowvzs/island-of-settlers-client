import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { getBuildingDefinition } from "../../../src/render-common/buildings/building-catalog";
import { adventureRewardGoods } from "../../../src/shared/settlement/adventure-rules";
import { getConstructionCost } from "../../../src/shared/settlement/construction-costs";
import type { ColonyExpeditionSnapshot } from "../../../src/shared/settlement/settlement-colony-expeditions";
import { workshopUpgradeCost } from "../../../src/shared/settlement/workshop-upgrades";
import { confirmImport, openMenuAction } from "../../bench/save-helpers";
import { writeCheckpoint } from "./checkpoints";
import { selectBuilding } from "./natural-ui-helpers";
import { clickGround } from "./natural-ui-helpers";
import { exportRecording, startRecording } from "./recording";
import { MissingPrerequisite } from "./report";
import { runShipCases } from "./ship-cases";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;
type Kind = "colony" | "adventure";
export interface JourneyTimeline {
  transitions: { kind: Kind; phase: string; at: string; checkpoint?: string; recording?: string }[];
}
export interface JourneyOptions { artifactsDirectory?: string; timeline?: JourneyTimeline }

/** Entries ordered by key (code-unit order), so two counts compare independent of insertion order. */
const sortedEntries = (record: Readonly<Record<string, unknown>>) =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : Number(a > b)));

const navigateUi = async (page: Page, button: ReturnType<Page["getByRole"]>) => {
  const loaded = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame(), timeout: 120_000 });
  await button.click(); await loaded;
  await page.waitForFunction(() => (window as any).__islandReady === true, undefined, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
};

const expandIslandTracker = async (page: Page) => {
  const expand = page.getByRole("button", { name: "Show expeditions", exact: true });
  if (await expand.isVisible()) await expand.click();
};

/** Ordinary voyages from sufficient user-authored checkpoints; never creates supplies, ships or victories. */
export const runJourneyCases = async (page: Page, runCase: RunCase, kind: Kind, options: JourneyOptions = {}) => {
  const timeline = options.timeline ?? { transitions: [] };
  const boundary = async (phase: string, transition = false) => {
    if (!options.artifactsDirectory) throw new MissingPrerequisite("Journey needs an artifact directory for linked checkpoints/recording segments");
    await mkdir(options.artifactsDirectory, { recursive: true });
    const name = `${kind}-${phase}-${timeline.transitions.length}`;
    const checkpoint = await writeCheckpoint(page, join(options.artifactsDirectory, "journey-checkpoints"), name);
    let recording: string | undefined;
    if (transition) recording = (await exportRecording(page, options.artifactsDirectory, name)).filename;
    const close = page.getByRole("button", { name: "Close development tools panel", exact: true });
    if (await close.isVisible()) await close.click();
    timeline.transitions.push({ kind, phase, at: new Date().toISOString(), checkpoint: checkpoint.manifestPath, recording });
    await writeFile(join(options.artifactsDirectory, "journey-timeline.json"), JSON.stringify(timeline, null, 2));
    return { checkpoint, game: JSON.parse(await readFile(checkpoint.gamePath, "utf8")) };
  };
  let homeBoundary: any;
  let wonBoundary: any;
  let returnedBoundary: any;
  let fought = false;
  let localBuilding: number | undefined;
  let expeditionId: number | undefined;
  let visited = false;
  await runCase(`E2E-${kind}-departure`, `Prepare and depart a real ${kind} expedition`, async () => {
    const state = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation;
      return { expeditions: sim.colonyExpeditions(), harbours: sim.buildings()
        .filter((b: any) => b.typeId === 39 && b.construction >= 1 && !(b.militaryFaction > 0)),
        ships: sim.ships(), abroad: !!(sim.colony() || sim.adventure()) };
    });
    if (state.abroad) throw new MissingPrerequisite("Departure needs a home-island checkpoint");
    const existing = state.expeditions.find((entry: any) => (entry.island.kind === "adventure") === (kind === "adventure"));
    if (existing) { expeditionId = existing.id; return { resumed: existing }; }
    if (!state.harbours.length || !state.ships.length)
      throw new MissingPrerequisite("Needs a completed supplied harbour, stored troops and real ships");
    await page.keyboard.press("Escape");
    try { await revealGround(page, state.harbours[0]); await clickGround(page, state.harbours[0]); }
    catch { throw new MissingPrerequisite("Checkpoint camera must show the departure harbour for real map picking"); }
    const action = page.locator(`[data-harbour-${kind}]`).first();
    if (!await action.isVisible() || await action.isDisabled())
      throw new MissingPrerequisite("Harbour expedition action unavailable; finish existing preparation/progression");
    await action.click();
    const planner = page.getByRole("dialog", {
      name: kind === "colony" ? "Colony expedition" : "Adventure expedition", exact: true
    });
    await planner.waitFor({ state: "visible" });
    const islands = planner.getByRole("radio");
    const count = await islands.count(); let chosen = false;
    for (let index = 0; index < count; index++) if (!await islands.nth(index).isDisabled()) {
      await islands.nth(index).click(); chosen = true; break;
    }
    if (!chosen) throw new MissingPrerequisite("No discovered free island is offered");
    for (const input of await planner.locator('input[type="number"]').all()) {
      const maximum = Number(await input.getAttribute("max"));
      if (maximum > 0) { await input.fill(String(maximum)); await input.press("Tab"); }
    }
    const start = planner.getByRole("button", { name: "Start expedition", exact: true });
    if (await start.isDisabled()) throw new MissingPrerequisite(await planner.innerText());
    await start.click();
    if (await planner.isVisible()) throw new MissingPrerequisite(await planner.getByRole("status").innerText());
    const expeditions = await page.evaluate(() => (window as any).__settlement.simulation.colonyExpeditions());
    const created = expeditions.find((entry: any) => (entry.island.kind === "adventure") === (kind === "adventure"));
    assert(created, "Start expedition UI returned without creating a voyage"); expeditionId = created.id;
    return { startedViaUi: true, created };
  });
  await runCase(`E2E-${kind}-arrival`, `Observe real ${kind} loading, sailing and arrival`, async () => {
    if (expeditionId === undefined) throw new MissingPrerequisite("Departure prerequisite did not complete");
    const samples: unknown[] = []; const deadline = Date.now() + 600_000;
    while (Date.now() < deadline) {
      const expedition: ColonyExpeditionSnapshot | undefined = await page.evaluate((id) => (window as any).__settlement.simulation.colonyExpeditions()
        .find((entry: any) => entry.id === id), expeditionId);
      assert(expedition, "Expedition disappeared before arrival");
      samples.push(expedition); if (samples.length > 120) samples.shift();
      if (expedition.status === "arrived") return { samples, wallLimitSeconds: 600 };
      await page.waitForTimeout(1000);
    }
    throw new Error(`Real voyage did not arrive within 600 wall seconds: ${JSON.stringify(samples.at(-1))}`);
  });
  await runCase(`E2E-${kind}-visit`, `Visit actual arrived ${kind} through island UI`, async () => {
    if (expeditionId === undefined) throw new MissingPrerequisite("No expedition was selected");
    await expandIslandTracker(page);
    const visit = page.locator(`[data-${kind}-visit="${expeditionId}"]`);
    if (!await visit.isVisible() || await visit.isDisabled()) throw new MissingPrerequisite("Voyage has not produced a visitable island");
    homeBoundary = await boundary("home-before-visit", true);
    await navigateUi(page, visit);
    await startRecording(page);
    await boundary("arrived");
    const state = await page.evaluate((type) => {
      const sim = (window as any).__settlement.simulation;
      return type === "colony" ? sim.colony() : sim.adventure();
    }, kind);
    assert(state, "Visit UI did not initialize the requested island type"); visited = true;
    return { state, actualUiVisit: true };
  });
  if (visited) await runShipCases(page, runCase);
  await runCase(`E2E-${kind}-conquest`, `Fight and conquer the actual ${kind} through army UI`, async () => {
    if (!visited) throw new MissingPrerequisite("Island visit did not complete");
    const result = await fightThroughUi(page, kind); fought = true;
    if (kind === "colony") {
      const stay = page.getByRole("button", { name: "Stay and build", exact: true });
      if (await stay.isVisible()) await stay.click();
    }
    await page.keyboard.press("Escape");
    wonBoundary = await boundary("won");
    return result;
  });
  if (kind === "colony") {
    await runCase("E2E-colony-local-construction", "Use finite landed supplies for actual local construction", async () => {
      if (!fought) throw new MissingPrerequisite("This journey did not conquer its colony through UI combat");
      const result = await buildColonyWell(page); localBuilding = result.uid;
      await boundary("local-construction"); return result;
    });
    await runCase("E2E-colony-local-upgrade", "Local upgrade uses delivered hardwood and marble with a real builder", async () => {
      if (localBuilding === undefined) throw new MissingPrerequisite("No naturally completed local Well");
      return upgradeColonyWell(page, localBuilding);
    });
    await runCase("E2E-colony-survivor-recall", "Request a real ship to return unneeded surviving soldiers", async () => {
      if (!fought || expeditionId === undefined) throw new MissingPrerequisite("No genuinely conquered colony");
      await expandIslandTracker(page);
      const recall = page.locator(`[data-colony-recall="${expeditionId}"]`);
      if (!await recall.isVisible() || await recall.isDisabled())
        throw new MissingPrerequisite("No recallable survivors or accessible colony harbour");
      await recall.click();
      const state = await page.evaluate(() => (window as any).__settlement.simulation.saveState());
      const ships = state.naval.fleet.ships.filter((ship: any) => ship.visitor?.pickupTroops?.length);
      assert(ships.length > 0, "Recall UI did not create a finite troop pickup request");
      return { ships, note: "Garrison keepers remain; actual return receipt is checked at home" };
    });
  }
  await runCase(`E2E-${kind}-return-home`, `Return home through ordinary island UI`, async () => {
    if (!visited) throw new MissingPrerequisite("No visited island");
    await expandIslandTracker(page);
    const back = page.getByRole("button", { name: "Return to the home island", exact: true });
    if (!await back.isVisible()) throw new MissingPrerequisite("Home-island navigation unavailable");
    if (!fought) throw new MissingPrerequisite("This journey has no actual conquest; returning would not establish victorious continuity");
    await boundary("before-home", true);
    const sail = page.getByRole("button", { name: "Sail home", exact: true });
    await navigateUi(page, await sail.isVisible() ? sail : back);
    await startRecording(page);
    const abroad = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation; return !!(sim.colony() || sim.adventure());
    });
    assert(!abroad, "Return home retained the remote island simulation");
    const returned = await boundary("home-returned"); returnedBoundary = returned;
    return { uiReturnHome: true, checkpoint: returned.checkpoint.manifestPath,
      note: "Navigation alone does not establish reward/cargo receipt; inspect the next case" };
  });
  await runCase(`E2E-${kind}-return-receipt`, "Observe survivor/reward ships, finite receipt and reload exactly-once", async () => {
    if (!fought || !homeBoundary || !wonBoundary || !returnedBoundary) throw new MissingPrerequisite("Actual departure, combat and saved victory are required");
    return verifyJourneyReceipt(page, kind, homeBoundary.game, wonBoundary.game, returnedBoundary?.game, boundary);
  });
};

/** Uses keyboard panning, preserving actual camera/picking code for every target. */
const revealGround = async (page: Page, point: { x: number; z: number }) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    const target = await page.evaluate(({ x, z }) => {
      const screen = (window as any).__settlement.projectGround(x, z);
      return { ...screen, width: innerWidth, height: innerHeight };
    }, point);
    if (target.x > 160 && target.x < target.width - 160 && target.y > 170 && target.y < target.height - 160) return;
    const dx = target.x - target.width / 2, dy = target.y - target.height / 2;
    const horizontalKey = dx > 0 ? "ArrowRight" : "ArrowLeft";
    const verticalKey = dy > 0 ? "ArrowDown" : "ArrowUp";
    const key = Math.abs(dx) > Math.abs(dy) ? horizontalKey : verticalKey;
    await page.keyboard.down(key);
    try { await page.waitForTimeout(140); } finally { await page.keyboard.up(key); }
  }
  throw new MissingPrerequisite(`Camera could not reveal target through UI panning: ${JSON.stringify(point)}`);
};

const combatFacts = (page: Page, kind: Kind) => page.evaluate(type => {
  const sim = (window as any).__settlement.simulation;
  const soldiers = sim.militarySoldiers();
  return { outcome: type === "colony" ? sim.colony() : sim.adventure(),
    friendly: soldiers.filter((soldier: any) => (soldier.combat?.faction ?? 0) === 0),
    hostile: soldiers.filter((soldier: any) => (soldier.combat?.faction ?? 0) > 0),
    buildings: sim.buildings().filter((building: any) => (building.militaryFaction ?? 0) > 0)
      .map((building: any) => ({ uid: building.uid, x: building.x, z: building.z, access: building.access })),
    bodies: sim.frames().filter((actor: any) => actor.job === "Soldier")
      .map((actor: any) => ({ uid: actor.uid, x: actor.x, z: actor.z, phase: actor.phase })),
    rally: sim.militaryRally() };
}, kind);

const fightThroughUi = async (page: Page, kind: Kind) => {
  const initial = await combatFacts(page, kind);
  if (initial.outcome?.status !== "contested") throw new MissingPrerequisite(
    "Real combat proof needs a contested arrival from this journey; an already won checkpoint cannot substitute");
  if (!initial.friendly.length || (!initial.hostile.length && !initial.buildings.length))
    throw new MissingPrerequisite("Contested island lacks landed player troops or actual enemies");
  const samples: unknown[] = [], orders: unknown[] = [];
  const landingDeadline = Date.now() + 180_000;
  await page.getByRole("button", { name: "Choose rally point", exact: true }).click();
  const firstBody = initial.bodies.find((body: any) => initial.friendly.some((soldier: any) => soldier.actor === body.uid));
  if (firstBody) {
    await revealGround(page, firstBody); await clickGround(page, firstBody);
    const banner = await page.evaluate(() => (window as any).__settlement.simulation.militaryRally());
    if (banner) {
      await page.getByRole("button", { name: "Cancel rally point", exact: true }).click();
      assert(!await page.evaluate(() => (window as any).__settlement.simulation.militaryRally()), "Cancel rally retained the banner");
      orders.push({ action: "Rally/cancel actual landed troop position", banner });
    } else await page.keyboard.press("Escape");
  } else await page.keyboard.press("Escape");
  const deadline = Date.now() + 1200_000;
  let nextOrderAt = 0;
  while (Date.now() < deadline) {
    const state = await combatFacts(page, kind);
    if (["won", "conquered"].includes(state.outcome?.status)) {
      return { initial, final: state, orders, samples, proof: "Actual UI attack orders and real application combat scheduler" };
    }
    assert(state.friendly.length > 0 && state.outcome?.status !== "defeated", "The finite expedition army lost its battle");
    if (samples.length >= 120) samples.shift();
    samples.push({ at: Date.now(), status: state.outcome?.status, friendly: state.friendly.length,
      hostile: state.hostile.length, forts: state.buildings.length });
    if (Date.now() >= nextOrderAt) {
      const enemy = state.buildings[0] ?? state.bodies.find((actor: any) =>
        state.hostile.some((soldier: any) => soldier.actor === actor.uid));
      if (enemy) {
        await revealGround(page, enemy);
        await page.getByRole("button", { name: "Select troops", exact: true }).click();
        const close = page.getByRole("button", { name: "Close troop selection", exact: true });
        if (await close.isVisible()) await close.click();
        const attack = page.getByRole("button", { name: "Attack / attack move", exact: true });
        if (!await attack.isVisible()) {
          const landed = state.bodies.some((body: any) => state.friendly.some((soldier: any) => soldier.actor === body.uid));
          if (Date.now() > landingDeadline && !landed)
            throw new MissingPrerequisite("No field troops became visible after actual landing");
          nextOrderAt = Date.now() + 20_000;
          await page.waitForTimeout(1000); continue;
        }
        await attack.click(); await clickGround(page, enemy);
        const feedback = await page.locator(".settlement-ui__status").allTextContents();
        orders.push({ at: Date.now(), target: enemy, feedback });
      }
      nextOrderAt = Date.now() + 20_000;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`Finite army failed to conquer through UI orders within 1200s: ${JSON.stringify(samples.at(-1))}`);
};

const buildColonyWell = async (page: Page) => {
  const before = await page.evaluate(() => {
    const sim = (window as any).__settlement.simulation;
    return { buildings: sim.buildings(), status: sim.colony()?.status };
  });
  assert.equal(before.status, "conquered");
  if (before.buildings.some((building: any) => building.typeId === 35))
    throw new MissingPrerequisite("Local construction case needs a newly placed Well rather than an existing one");
  const cost = getConstructionCost(35);
  for (const [ware, amount] of Object.entries(cost)) {
    const available = before.buildings.reduce((sum: number, building: any) => sum + (building.inventory[ware] ?? 0), 0);
    if (available < amount) throw new MissingPrerequisite(`Finite landed ${ware}: ${available}/${amount}; request real supplies`);
  }
  await selectBuilding(page, 35);
  const plot = await page.evaluate((footprint) => {
    const live = (window as any).__settlement, sim = live.simulation;
    const home = sim.home(), rotation = live.controls.rotation();
    const width = footprint[rotation % 2 ? 1 : 0], depth = footprint[rotation % 2 ? 0 : 1];
    for (let radius = 6; radius <= 24; radius += 2) for (let step = 0; step < 32; step++) {
      const x = Math.round(home.x + Math.cos(step * Math.PI / 16) * radius) + width % 2 / 2;
      const z = Math.round(home.z + Math.sin(step * Math.PI / 16) * radius) + depth % 2 / 2;
      if (!sim.validatePlacement(35, x, z, rotation)) return { x, z, rotation };
    }
    throw new Error("No legal local Well plot near colony harbour");
  }, getBuildingDefinition(35).gridFootprint);
  await revealGround(page, plot); await clickGround(page, plot);
  await page.waitForFunction(() => (window as any).__settlement.simulation.buildings()
    .some((building: any) => building.typeId === 35), null, { timeout: 10_000 });
  const endpoints = await page.evaluate(() => {
    const sim = (window as any).__settlement.simulation, building = sim.buildings().find((item: any) => item.typeId === 35);
    return { start: { ...sim.home().access }, end: { ...building.access }, uid: building.uid, revision: sim.roadRevision() };
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Roads", exact: true }).click();
  await page.getByRole("button", { name: "Dirt road", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await revealGround(page, endpoints.start); await clickGround(page, endpoints.start);
  await revealGround(page, endpoints.end); await clickGround(page, endpoints.end);
  await page.keyboard.press("Escape");
  await page.waitForFunction(uid => (window as any).__settlement.simulation.buildings()
    .find((building: any) => building.uid === uid)?.construction === 1, endpoints.uid, { timeout: 240_000 });
  const completed = await page.evaluate(uid => (window as any).__settlement.simulation.snapshot().buildings
    .find((building: any) => building.uid === uid), endpoints.uid);
  assert(Object.values(completed.constructionConsumed ?? {}).some(amount => Number(amount) > 0),
    "Local building lacks actual consumed construction materials");
  await page.waitForFunction(uid => {
    const sim = (window as any).__settlement.simulation;
    return sim.buildings().find((building: any) => building.uid === uid)?.cycle >= 3 && sim.resourceTotal("water") > 0;
  }, endpoints.uid, { timeout: 240_000 });
  return { uid: endpoints.uid, plot, endpoints, completed, proof: "Real builder, finite landed materials and three water cycles" };
};

/** The colony well's first upgrade (building level 2). */
const WELL_UPGRADE_COST = workshopUpgradeCost({ typeId: 35 });
const upgradeColonyWell = async (page: Page, uid: number) => {
  const state = await page.evaluate(id => {
    const sim = (window as any).__settlement.simulation;
    return { building: sim.buildings().find((building: any) => building.uid === id), buildings: sim.buildings() };
  }, uid);
  for (const [ware, amount] of Object.entries(WELL_UPGRADE_COST)) {
    const available = state.buildings.reduce((sum: number, building: any) => sum + (building.inventory[ware] ?? 0), 0);
    if (available < amount) throw new MissingPrerequisite(`Local upgrade needs real delivered ${ware}: ${available}/${amount}; no grant used`);
  }
  await revealGround(page, state.building); await clickGround(page, state.building);
  const action = page.locator(`[data-workshop-upgrade="${uid}"]`);
  if (!await action.isVisible() || await action.isDisabled()) throw new MissingPrerequisite("Local upgrade control/supply is unavailable");
  await action.click();
  const control = page.locator(".workshop-upgrade-modal").getByRole("button", { name: "Upgrade", exact: true });
  if (!await control.isVisible() || await control.isDisabled()) throw new MissingPrerequisite("Local upgrade control/supply is unavailable");
  await control.click();
  await page.waitForFunction(id => (window as any).__settlement.simulation.buildings()
    .find((building: any) => building.uid === id)?.workshopUpgrade?.level === 1, uid, { timeout: 240_000 });
  return { uid, actualUpgrade: true, expectedCost: WELL_UPGRADE_COST };
};

type Boundary = (phase: string, transition?: boolean) => Promise<{ checkpoint: { gamePath: string; manifestPath: string }; game: any }>;
const troopCounts = (soldiers: any[]) => soldiers.reduce((counts: Record<string, number>, soldier: any) => {
  if ((soldier.combat?.faction ?? 0) === 0) {
    const type = soldier.combat?.type ?? "shield"; counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}, {});

const verifyJourneyReceipt = async (page: Page, kind: Kind, home: any, victory: any, returned: any, boundary: Boundary) => {
  const expectedTroops = troopCounts(home.settlement.military?.soldiers ?? []);
  const survivors = troopCounts(victory.settlement.military?.soldiers ?? []);
  for (const [type, count] of Object.entries(survivors)) expectedTroops[type] = (expectedTroops[type] ?? 0) + Number(count);
  const homeOrders = home.settlement.tavern;
  if (homeOrders?.orders?.length || homeOrders?.batches?.length)
    throw new MissingPrerequisite("Independent survivor accounting needs a checkpoint with no pending home recruitment");
  let expectedReward: Record<string, number> | undefined;
  if (kind === "adventure") {
    expectedReward = adventureRewardGoods(victory.settlement.adventure.island);
    const dispatched = returned?.settlement.naval.fleet.ships.filter((ship: any) => ship.visitor?.role === "reward");
    assert.equal(dispatched?.length, 1, "Victory must dispatch exactly one actual reward vessel");
    assert.deepEqual(dispatched[0].cargo, expectedReward, "Reward vessel carries different quantities from the declared victory reward");
  }
  let last: any;
  const samples: unknown[] = [], deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation;
      const saved = sim.saveState();
      return { soldiers: saved.military?.soldiers ?? [], ships: saved.naval.fleet.ships,
        storages: saved.buildings.filter((building: any) => [0, 29, 39].includes(building.typeId)) };
    });
    const counts = troopCounts(last.soldiers);
    const incoming = last.ships.filter((ship: any) => ship.visitor && !ship.visitor.leaving);
    samples.push({ at: Date.now(), counts, incoming: incoming.map((ship: any) => ({ id: ship.id,
      role: ship.visitor.role, phase: ship.phase, cargo: ship.cargo, troops: ship.troops?.length ?? 0 })) });
    if (samples.length > 120) samples.shift();
    if (JSON.stringify(sortedEntries(counts)) === JSON.stringify(sortedEntries(expectedTroops)) &&
      !incoming.some((ship: any) => ["troops", "reward"].includes(ship.visitor.role))) break;
    await page.waitForTimeout(1000);
  }
  assert.deepEqual(troopCounts(last.soldiers), expectedTroops, "Returning finite survivors were lost/duplicated or remained aboard");
  const received = await boundary("receipt-before-reload", true);
  const pending = received.game.archipelago;
  assert(!pending?.returning?.length && !pending?.rewards, "Already dispatched rewards/survivors remain queued for duplicate delivery");
  const rewardShips = last.ships.filter((ship: any) => ship.visitor?.role === "reward");
  assert(rewardShips.every((ship: any) => Object.values(ship.cargo).every(amount => Number(amount) === 0)),
    "Reward ship still holds undelivered goods");
  const loaded = page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame(), timeout: 120_000 });
  const action = await openMenuAction(page, "Import game");
  const chooser = page.waitForEvent("filechooser"); await action.click();
  await (await chooser).setFiles(received.checkpoint.gamePath); await confirmImport(page); await loaded;
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await startRecording(page);
  const reloaded = await boundary("receipt-reloaded");
  assert.deepEqual(troopCounts(reloaded.game.settlement.military?.soldiers ?? []), expectedTroops,
    "Reload duplicated or lost returning soldiers");
  assert(!reloaded.game.archipelago?.returning?.length && !reloaded.game.archipelago?.rewards,
    "Reload requeued an already dispatched return");
  const newRewards = reloaded.game.settlement.naval.fleet.ships.filter((ship: any) => ship.visitor?.role === "reward");
  assert(newRewards.every((ship: any) => rewardShips.some((before: any) => before.id === ship.id)),
    "Reload created a second reward ship");
  return { kind, survivors, expectedTroops, expectedReward, samples, restoredCheckpoint: reloaded.checkpoint.manifestPath,
    scope: "Finite troop counts, completed reward unloading, no pending duplicate dispatch or extra reward vessel after reload. " +
      "Per-ware independent inventory conservation under concurrent production requires the dedicated economy ledger case." };
};
