import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

type Page = import("playwright-core").Page;
type Fixture = import("./commander-acceptance-fixture").CommanderAcceptanceFixture;

/**
 * Native High/Minimal commander acceptance (`npx tsx tools/bench/commander-acceptance-review.ts`).
 * A generated level-13 island builds the lodge for real, pays the commander, saves/reloads, plans a
 * colony and an adventure, sails, fights, wins, returns a casualty and then a living low-HP commander.
 * It checks that one victory awards one XP, including destination save/reload.
 */
const output = process.env.OUT ?? resourcesPath("project-reviews", "commander-acceptance-2026-10-27");
mkdirSync(output, { recursive: true });
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",").filter(Boolean);
const { server, url } = await startDevServer();
const browser = await launchBrowser(true);
const receipts: Array<Record<string, any>> = [];
const allErrors: string[] = [];

const screenshot = async (page: Page, quality: string, name: string) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(output, `${quality}-${name}.png`) });
};
const sectionShot = async (page: Page, quality: string, selector: string, name: string) => {
  await page.waitForTimeout(250);
  await page.locator(selector).first().screenshot({ path: resolve(output, `${quality}-${name}.png`) });
};
const ready = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
  await page.waitForTimeout(800);
};
const advance = (page: Page, seconds: number) => page.evaluate(seconds => {
  const simulation = (window as any).__settlement.simulation;
  for (let tick = 0; tick < seconds * 20; tick++) simulation.update(.05);
}, seconds);
const clickGround = async (page: Page, x: number, z: number, zoom = 1.7) => {
  await page.evaluate(({ x, z, zoom }) => {
    (window as any).__settlement.focusGround(x, z, zoom);
  }, { x, z, zoom });
  await page.waitForTimeout(700);
  const point = await page.evaluate(({ x, z }) =>
    (window as any).__settlement.projectGround(x, z), { x, z });
  await page.mouse.click(point.x, point.y);
};
const commanderState = (page: Page) => page.evaluate(() => {
  const simulation = (window as any).__settlement.simulation;
  const commander = simulation.commanderSnapshot();
  const soldier = simulation.militarySoldiers().find((entry: any) => entry.commanderId === commander?.id);
  const actor = simulation.frames().find((entry: any) => entry.uid === soldier?.actor);
  const mount = simulation.frames().find((entry: any) => entry.uid === soldier?.combat?.mount);
  return { actor: actor && { phase: actor.phase, tool: actor.tool, visible: actor.visible, x: actor.x, z: actor.z },
    commander, mount: mount && { phase: mount.phase, uid: mount.uid }, soldier, transport: simulation.commanderTransport() };
});
const saveSummary = (page: Page) => page.evaluate(async () => {
  const path = "/src/app/save-store/local-save-store.ts";
  const { openLocalSaveStore } = await import(/* @vite-ignore */ path);
  const saved = await (await openLocalSaveStore()).readSavedGame();
  return { active: saved?.archipelago?.active ?? null, commander: saved?.settlement.military?.commander,
    playerCommander: saved?.player?.commander, seed: saved?.settlement.world?.seed,
    adventure: saved?.settlement.adventure?.status ?? null, colony: saved?.settlement.colony?.status ?? null };
});
const flushSave = (page: Page) => page.evaluate(async () => {
  const settlement = (window as any).__settlement;
  return settlement.saving.flush("manual");
});
const reloadHome = async (page: Page) => {
  await Promise.all([page.waitForEvent("load"), page.evaluate(async () => {
    const path = "/src/app/save-store/local-save-store.ts";
    const { openLocalSaveStore } = await import(/* @vite-ignore */ path);
    const store = await openLocalSaveStore();
    const saved = await store.readSavedGame();
    if (!saved) throw new Error("No saved home game");
    await store.writeStartupGame(JSON.stringify(saved));
    location.reload();
  })]);
  await ready(page);
};
const closeBuildingDetails = async (page: Page) => {
  const close = page.locator(".settlement-ui__building-details-window button[aria-label^='Close']").first();
  if (await close.count() && await close.isVisible()) await close.click();
  await page.waitForTimeout(300);
};
const openHarbour = async (page: Page, harbour: Fixture["harbour"]) => {
  const action = page.locator(`[data-harbour-adventure="${harbour.uid}"]`).first();
  if (await action.count() && await action.isVisible()) return;
  await clickGround(page, harbour.x, harbour.z, 1.7);
  await page.locator(`[data-harbour-adventure="${harbour.uid}"]`).first().waitFor({ state: "visible", timeout: 10_000 });
};
const openPlanner = async (page: Page, harbour: Fixture["harbour"], kind: "colony" | "adventure") => {
  const selector = kind === "colony" ? "Colony expedition" : "Adventure expedition";
  const action = page.locator(`[data-harbour-${kind}="${harbour.uid}"]`).first();
  if (!await action.count() || !await action.isVisible()) await openHarbour(page, harbour);
  await page.locator(`[data-harbour-${kind}="${harbour.uid}"]`).first().click();
  const planner = page.locator(".settlement-ui__colony-planner-window").filter({ hasText: selector });
  await planner.waitFor({ state: "visible", timeout: 10_000 });
  return planner;
};
const closePlanner = async (page: Page) => {
  const close = page.locator(".settlement-ui__colony-planner-window button[aria-label^='Close']").first();
  if (await close.count()) await close.click();
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
};
const chooseCommander = async (page: Page, planner: any, id: string) => {
  const card = planner.locator(`[data-commander-card="${id}"]`);
  await card.waitFor({ state: "visible", timeout: 10_000 });
  if (await card.isDisabled()) throw new Error("Commander card is disabled");
  await card.click();
};
const setTroops = async (page: Page, planner: any, clicks: number, decrease = false) => {
  const name = decrease ? /^Fewer (swordsmen|shield warriors)$/ : /^More (swordsmen|shield warriors)$/;
  for (let index = 0; index < clicks; index++)
    await planner.getByRole("button", { name }).click();
  await page.waitForTimeout(250);
};
const waitForTransportPhase = (page: Page, phases: readonly string[], limitSeconds = 900) =>
  page.evaluate(({ limitSeconds, phases }) => {
    const simulation = (window as any).__settlement.simulation;
    const seen: string[] = [];
    for (let tick = 0; tick < limitSeconds * 20; tick++) {
      simulation.update(.05);
      const transport = simulation.commanderTransport();
      const phase = transport?.phase ?? "none";
      if (seen[seen.length - 1] !== phase) seen.push(phase);
      if (phases.includes(phase)) return { seen, transport, ship: simulation.ships()[0] };
    }
    return { seen, transport: simulation.commanderTransport(), ship: simulation.ships()[0] };
  }, { limitSeconds, phases });

const fight = (page: Page, limitSeconds = 2000) => page.evaluate(limit => {
  const simulation = (window as any).__settlement.simulation;
  const field = (faction: boolean) => simulation.militarySoldiers().filter((soldier: any) =>
    ((soldier.combat?.faction ?? 0) > 0) === faction && !soldier.stationed);
  const body = (id: number) => simulation.frames().find((actor: any) => actor.uid === id);
  for (let second = 0; second < limit; second++) {
    const enemies = field(true);
    if (!enemies.length) return { cleared: true, seconds: second, survivors: field(false).length };
    if (second % 10 === 0) {
      const ours = field(false).map((soldier: any) => soldier.actor);
      const target = body(enemies[0].actor);
      if (target && ours.length) simulation.commandMilitary(ours, { x: target.x, z: target.z }, "attackMove");
    }
    simulation.update(1);
  }
  return { cleared: false, left: field(true).length, survivors: field(false).length };
}, limitSeconds);

const createFixture = async (page: Page) => {
  await page.route("**/commander-acceptance-fixture.html", route => route.fulfill({
    contentType: "text/html", body: "<body></body>"
  }));
  await page.goto(`${url}commander-acceptance-fixture.html`);
  return page.evaluate(async () => {
    const { createCommanderAcceptanceFixture } = await import(
      /* @vite-ignore */ String("/tools/bench/commander-acceptance-fixture.ts"));
    return createCommanderAcceptanceFixture({ completeLodge: false, surroundLodgeRoads: true });
  }) as Promise<Fixture>;
};

const runLodge = async (page: Page, quality: string, fixture: Fixture, report: Record<string, unknown>) => {
  const before = await page.evaluate(lodge => {
    const simulation = (window as any).__settlement.simulation;
    const site = simulation.buildings().find((building: any) => building.uid === lodge.uid);
    return { construction: site.construction, foundation: site.foundationProgress, status: site.status,
      stock: { ...simulation.headquarters.inventory } };
  }, fixture.lodge);
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  await page.waitForTimeout(500);
  await screenshot(page, quality, "01-lodge-construction");
  const built = await page.evaluate(lodge => {
    const simulation = (window as any).__settlement.simulation;
    const site = simulation.buildings().find((building: any) => building.uid === lodge.uid);
    let seconds = 0;
    for (; seconds < 600 && site.construction < 1; seconds++) simulation.update(1);
    return { construction: site.construction, foundation: site.foundationProgress, seconds,
      status: site.status, stock: { ...simulation.headquarters.inventory } };
  }, fixture.lodge);
  assert.equal(built.construction, 1, "the real lodge construction must complete");
  await page.waitForTimeout(800);
  await screenshot(page, quality, "02-lodge-complete");
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  await page.locator(".settlement-ui__commander").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".settlement-ui__commander-open-selector").click();
  const recruitPanel = page.locator(".commander-selector-window");
  await recruitPanel.waitFor({ state: "visible" });
  assert.equal(await recruitPanel.getByRole("radio").first().getAttribute("aria-checked"), "true");
  const emptyText = await recruitPanel.innerText();
  await sectionShot(page, quality, ".commander-selector-window", "03-lodge-card-requirements");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const { languagePreference } = await import(/* @vite-ignore */ String("/src/app/localization/language-store.ts"));
    languagePreference.setLanguage("hu");
    await languagePreference.ready();
  });
  await page.waitForTimeout(600);
  const hungarianText = await recruitPanel.innerText();
  assert.match(hungarianText, /Parancsnok kiválasztása/);
  const phoneBounds = await recruitPanel.boundingBox();
  assert(phoneBounds && phoneBounds.x >= 0 && phoneBounds.x + phoneBounds.width <= 390.5);
  await screenshot(page, quality, "03b-selector-phone-hu");
  await page.evaluate(async () => {
    const { languagePreference } = await import(/* @vite-ignore */ String("/src/app/localization/language-store.ts"));
    languagePreference.setLanguage("en");
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await recruitPanel.locator('button[aria-label^="Close "]').first().click();
  await page.locator(".settlement-ui__commander-open-selector").click();
  await recruitPanel.waitFor({ state: "visible" });
  assert.equal(await recruitPanel.getByRole("radio").first().getAttribute("aria-checked"), "true");
  const selectorViews = { englishText: emptyText, hungarianText, phoneBounds, resetFirstOnReopen: true };
  await page.evaluate(() => { (window as any).__settlement.simulation.headquarters.inventory.beer = 0; });
  await page.waitForTimeout(900);
  const disabledText = await recruitPanel.innerText();
  assert.match(disabledText, /Missing:\s*10 Beer/);
  assert.equal(await page.locator(".settlement-ui__commander-recruit").isDisabled(), true);
  await sectionShot(page, quality, ".commander-selector-window", "04-lodge-card-disabled");
  await page.evaluate(() => { (window as any).__settlement.simulation.headquarters.inventory.beer = 20; });
  await page.waitForTimeout(900);
  const nineteenRefusal = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    simulation.headquarters.inventory.coins = 19;
    const before = simulation.saveState();
    const result = simulation.recruitCommander(simulation.buildings().find((site: any) => site.typeId === 62).uid);
    return { beforeStock: before.buildings.map((site: any) => site.inventory),
      afterStock: simulation.saveState().buildings.map((site: any) => site.inventory), result };
  });
  assert.equal(nineteenRefusal.result.ok, false);
  assert.deepEqual(nineteenRefusal.afterStock, nineteenRefusal.beforeStock);
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".settlement-ui__commander-recruit").isDisabled(), true);
  assert.equal(await page.locator('.settlement-ui__commander-cost-row[data-ware="coins"] output').innerText(), "20");
  await sectionShot(page, quality, ".commander-selector-window", "04b-lodge-19coins-refusal");
  await page.evaluate(() => { (window as any).__settlement.simulation.headquarters.inventory.coins = 20; });
  await page.waitForTimeout(600);
  const stockBefore = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { idle: simulation.availableSettlers(), stock: { ...simulation.headquarters.inventory } };
  });
  await page.locator(".settlement-ui__commander-recruit").click();
  await page.waitForTimeout(1200);
  const recruited = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const soldier = simulation.militarySoldiers().find((entry: any) => entry.commanderId === commander?.id);
    const actor = simulation.frames().find((entry: any) => entry.uid === soldier?.actor);
    const mount = simulation.frames().find((entry: any) => entry.uid === soldier?.combat?.mount);
    return { actor: actor && { phase: actor.phase, tool: actor.tool, visible: actor.visible },
      commander, idle: simulation.availableSettlers(), mount: mount && { phase: mount.phase },
      secondRecruit: simulation.recruitCommander(commander?.homeLodgeUid), soldier,
      stock: { ...simulation.headquarters.inventory } };
  });
  assert.match(await page.locator(".settlement-ui__commander").innerText(), /Astrid/);
  assert.deepEqual({ beer: stockBefore.stock.beer - recruited.stock.beer,
    coins: stockBefore.stock.coins - recruited.stock.coins, shield: stockBefore.stock.shield - recruited.stock.shield,
    sword: stockBefore.stock.sword - recruited.stock.sword, mead: stockBefore.stock.mead - recruited.stock.mead },
  { beer: 10, coins: 20, shield: 1, sword: 1, mead: 10 });
  assert.equal(stockBefore.idle - recruited.idle, 1);
  assert.equal(recruited.soldier.rank, 0);
  assert.equal(recruited.soldier.combat.type, "cavalry");
  assert.equal(recruited.actor.tool, "sword");
  assert.equal(recruited.mount.phase, "horseMounted");
  assert.equal(recruited.secondRecruit.ok, false);
  await sectionShot(page, quality, ".settlement-ui__commander", "05-lodge-card-recruited");
  await page.locator(".settlement-ui__commander-level-up").click();
  await page.waitForTimeout(800);
  const level2Text = await page.locator(".settlement-ui__commander").innerText();
  assert.match(level2Text, /Level 2/);
  assert.equal(await page.locator('.settlement-ui__commander [data-rank-level="2"]').count(), 1);
  assert.match(level2Text, /441 \/ 441/);
  await sectionShot(page, quality, ".settlement-ui__commander", "06-lodge-card-level2");
  // Save/reload identity.
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const save = simulation.saveState();
    save.military.soldiers = save.military.soldiers.map((soldier: any) => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .6 } } : soldier);
    if (!simulation.loadState(save).ok) throw new Error("wound load failed");
  });
  await page.waitForTimeout(500);
  assert.equal(await flushSave(page), true);
  const saved = await saveSummary(page);
  assert.equal(saved.playerCommander?.id, recruited.commander.id);
  assert.equal(saved.commander?.homeLodgeUid, fixture.lodge.uid);
  await reloadHome(page);
  const reloaded = await page.evaluate(lodge => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const soldier = simulation.militarySoldiers().find((entry: any) => entry.commanderId === commander?.id);
    const mount = simulation.frames().find((entry: any) => entry.uid === soldier?.combat?.mount);
    return { commander, mount: mount && { phase: mount.phase, uid: mount.uid },
      recruit: simulation.commanderRecruitStatus(lodge.uid), soldier };
  }, fixture.lodge);
  assert.equal(reloaded.commander.id, recruited.commander.id);
  assert.equal(reloaded.commander.homeLodgeUid, fixture.lodge.uid);
  assert.equal(reloaded.commander.level, 2);
  assert.equal(reloaded.commander.xp, 30);
  assert.ok(Math.abs(reloaded.commander.hp - reloaded.commander.maximumHp * .6) <=
    reloaded.commander.maximumHp * .011, `reloaded HP drifted: ${reloaded.commander.hp}`);
  assert.equal(reloaded.soldier.combat.mount, recruited.soldier.combat.mount);
  assert.equal(reloaded.mount.phase, "horseMounted");
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  await page.locator(".settlement-ui__commander").waitFor({ state: "visible", timeout: 10_000 });
  await sectionShot(page, quality, ".settlement-ui__commander", "07-lodge-card-reloaded");
  await closeBuildingDetails(page);
  report.lodge = { before, built, disabledText, emptyText, level2Text, nineteenRefusal, recruited, reloaded, saved, selectorViews,
    stockBefore };
};

const runPlanner = async (page: Page, quality: string, fixture: Fixture, commanderId: string,
  report: Record<string, unknown>) => {
  // Too-injured card at 40% actual HP.
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const save = simulation.saveState();
    save.military.soldiers = save.military.soldiers.map((soldier: any) => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .4 } } : soldier);
    if (!simulation.loadState(save).ok) throw new Error("too-injured load failed");
  });
  const tooInjured = await openPlanner(page, fixture.harbour, "adventure");
  await chooseCommander(page, tooInjured, commanderId).catch(() => undefined);
  const tooInjuredCard = tooInjured.locator(`[data-commander-card="${commanderId}"]`);
  const tooInjuredText = await tooInjuredCard.innerText();
  assert.match(tooInjuredText, /Too injured/);
  assert.equal(await tooInjuredCard.isDisabled(), true);
  await sectionShot(page, quality, ".colony-planner__commanders", "08-planner-too-injured");
  await closePlanner(page);
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const save = simulation.saveState();
    save.military.soldiers = save.military.soldiers.map((soldier: any) => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .6 } } : soldier);
    if (!simulation.loadState(save).ok) throw new Error("ready load failed");
  });
  const colony = await openPlanner(page, fixture.harbour, "colony");
  const colonyCards = await colony.locator("[data-commander-card]").evaluateAll(elements => elements.map(element => ({
    disabled: (element as HTMLButtonElement).disabled, id: element.getAttribute("data-commander-card"),
    text: (element as HTMLElement).innerText })));
  assert.equal(colonyCards.length, 2);
  assert.ok(colonyCards.some(card => card.text.includes("No commander")));
  assert.ok(colonyCards.some(card => card.id === commanderId));
  await colony.screenshot({ path: resolve(output, `${quality}-09-colony-planner.png`) });
  await closePlanner(page);
  const adventure = await openPlanner(page, fixture.harbour, "adventure");
  const easy = await page.evaluate(() => (window as any).__settlement.simulation.adventureIslands()
    .find((island: any) => island.difficulty === "easy"));
  await adventure.locator(`[data-colony-island="${easy.id}"]`).click();
  await chooseCommander(page, adventure, commanderId);
  await setTroops(page, adventure, 14);
  const oneLoadText = await adventure.innerText();
  assert.match(oneLoadText, /14 \/ 20 troops/);
  assert.match(oneLoadText, /1 ship\(s\) · 1 load\(s\)/);
  assert.match(oneLoadText, /1 troop-cap unit · 2 deck slots · sails in the first combat load/);
  await adventure.screenshot({ path: resolve(output, `${quality}-10-adventure-planner.png`) });
  await setTroops(page, adventure, 1);
  const twoLoadText = await adventure.innerText();
  assert.match(twoLoadText, /15 \/ 20 troops/);
  assert.match(twoLoadText, /1 ship\(s\) · 2 load\(s\)/);
  await setTroops(page, adventure, 1, true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await adventure.screenshot({ path: resolve(output, `${quality}-11-adventure-planner-phone.png`) });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(500);
  await setTroops(page, adventure, 5);
  await page.evaluate(harbourUid => {
    const simulation = (window as any).__settlement.simulation;
    simulation.transferWare(simulation.headquarters.uid, harbourUid, "planks", 12);
  }, fixture.harbour.uid);
  const planText = await adventure.innerText();
  assert.match(planText, /19 \/ 20 troops/);
  assert.match(planText, /2 load\(s\)/);
  await adventure.getByRole("button", { name: "Start expedition", exact: true }).click();
  await page.waitForTimeout(900);
  const atomic = await page.evaluate(({ commanderId, easy }) => {
    const simulation = (window as any).__settlement.simulation;
    const harbour = simulation.buildings().find((building: any) => building.typeId === 39);
    return { second: simulation.startAdventureExpedition(harbour.uid, easy.id, { shield: 19 }, false, commanderId),
      transport: simulation.commanderTransport() };
  }, { commanderId, easy });
  assert.equal(atomic.second.ok, false);
  report.planner = { atomic, colonyCards, oneLoadText, planText, tooInjuredText, twoLoadText };
  await closeBuildingDetails(page);
  return { adventure: easy };
};

const runExpedition = async (page: Page, quality: string, fixture: Fixture, easy: { id: number },
  commanderId: string, report: Record<string, unknown>, resumeOutward = false) => {
  let muster: unknown = null, followed = false;
  if (!resumeOutward) {
  const observedMuster = await waitForTransportPhase(page, ["muster"], 600);
  muster = observedMuster;
  assert.ok(observedMuster.transport, "the commander must muster");
  await page.evaluate(() => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const soldier = simulation.militarySoldiers().find((entry: any) => entry.commanderId === commander?.id);
    const actor = simulation.frames().find((entry: any) => entry.uid === soldier?.actor);
    settlement.focusGround(actor.x, actor.z, 1.8);
  });
  await page.waitForTimeout(900);
  await screenshot(page, quality, "12-muster");
  const abord = await waitForTransportPhase(page, ["aboard", "deployed"], 900);
  assert.ok(["aboard", "deployed"].includes(abord.transport?.phase));
  report.outwardPhaseObserved = abord;
  await page.evaluate(() => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    const ship = simulation.ships()[0];
    settlement.focusGround(ship.x, ship.z, 2);
  });
  await page.waitForTimeout(900);
  await screenshot(page, quality, "13-boarding");
  const shipPoint = await page.evaluate(() => {
    const settlement = (window as any).__settlement, ship = settlement.simulation.ships()[0];
    return settlement.projectGround(ship.x, ship.z);
  });
  await page.mouse.click(shipPoint.x, shipPoint.y);
  await page.waitForTimeout(700);
  const follow = page.locator("[data-follow-ship]").first();
  if (await follow.count()) {
    await follow.click();
    followed = true;
    await page.waitForTimeout(700);
    await screenshot(page, quality, "14-ship-following");
  }
  }
  const sailed = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 20 * 5000 && simulation.colonyExpeditions()[0]?.status !== "arrived"; tick++)
      simulation.update(.05);
    return { expedition: simulation.colonyExpeditions()[0], transport: simulation.commanderTransport(),
      homeSoldiers: simulation.militarySoldiers().filter((entry: any) => entry.commanderId).length };
  });
  assert.equal(sailed.expedition.status, "arrived");
  assert.equal(sailed.transport?.location, "away");
  assert.equal(sailed.homeSoldiers, 0);
  await page.waitForTimeout(700);
  await screenshot(page, quality, "15-tracker-sailing");
  const visit = page.locator("[data-adventure-visit]").first();
  await visit.waitFor({ state: "visible", timeout: 30_000 });
  await visit.click();
  await page.waitForFunction(() => Boolean((window as any).__settlement?.simulation.adventure()), null,
    { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
  await page.waitForTimeout(1000);
  const landing = await page.evaluate(() => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    for (let tick = 0; tick < 20 * 5000; tick++) {
      simulation.update(.05);
      const battle = simulation.adventure()?.battle?.sent ?? {};
      const sent = Object.values(battle).reduce((sum: number, value: any) => sum + Number(value), 0);
      if (simulation.commanderTransport()?.location === "field" && sent >= 19) break;
    }
    const commander = simulation.commanderSnapshot();
    const soldier = simulation.militarySoldiers().find((entry: any) => entry.commanderId === commander?.id);
    const actor = simulation.frames().find((entry: any) => entry.uid === soldier?.actor);
    // Gather ordinary troops round the commander so the six-tile ring and nearby allies are visible;
    // the exact inside/outside damage factors are covered by the focused hit-hook test.
    const allies = simulation.militarySoldiers().filter((entry: any) => (entry.combat?.faction ?? 0) === 0 &&
      !entry.commanderId).map((entry: any) => entry.actor);
    simulation.commandMilitary(allies, { x: actor.x + 2, z: actor.z }, "move");
    for (let tick = 0; tick < 20 * 120; tick++) {
      simulation.update(.05);
      const near = allies.map((id: number) => simulation.frames().find((body: any) => body.uid === id))
        .filter(Boolean).filter((body: any) => Math.hypot(body.x - actor.x, body.z - actor.z) <= 6).length;
      if (near >= 4) break;
    }
    const friendlies = simulation.militarySoldiers().filter((entry: any) => (entry.combat?.faction ?? 0) === 0)
      .map((entry: any) => simulation.frames().find((body: any) => body.uid === entry.actor))
      .filter(Boolean).map((body: any) => ({ distance: Math.hypot(body.x - actor.x, body.z - actor.z),
        x: body.x, z: body.z }));
    if (actor) settlement.focusGround(actor.x, actor.z, 1.8);
    return { actor: actor && { phase: actor.phase, x: actor.x, z: actor.z }, adventure: simulation.adventure(),
      aura: commander?.aura, commander, friendlies,
      inside: friendlies.filter((entry: any) => entry.distance <= 6).length,
      outside: friendlies.filter((entry: any) => entry.distance > 6).length, soldier,
      transport: simulation.commanderTransport() };
  });
  assert.equal(landing.commander?.location, "field");
  assert.equal(landing.soldier?.combat?.type, "cavalry");
  assert.equal(landing.commander?.deckSlots, 2);
  await page.waitForTimeout(1000);
  await screenshot(page, quality, "16-adventure-landing-aura");
  const battleBefore = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { commander: simulation.commanderSnapshot(), deaths: simulation.militaryDeaths().length,
      soldiers: simulation.militarySoldiers().length };
  });
  const deployedSave = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const save = simulation.saveState();
    const loaded = simulation.loadState(save);
    return { loaded, commander: simulation.commanderSnapshot(), adventure: simulation.adventure()?.status,
      soldier: simulation.militarySoldiers().find((entry: any) => entry.commanderId === simulation.commanderSnapshot()?.id) };
  });
  assert.equal(deployedSave.loaded.ok, true, JSON.stringify(deployedSave.loaded));
  assert.equal(deployedSave.adventure, "contested");
  assert.equal(deployedSave.commander.level, 2);
  assert.equal(deployedSave.commander.xp, 30);
  assert.equal(await flushSave(page), true);
  const savedDestination = await saveSummary(page);
  assert.equal(savedDestination.active, 1);
  assert.equal(savedDestination.adventure, "contested");
  assert.equal(savedDestination.commander?.homeLodgeUid, -1);
  await reloadHome(page);
  const reloadedDestination = await commanderState(page);
  assert.equal((await saveSummary(page)).active, savedDestination.active);
  assert.equal(reloadedDestination.commander?.id, deployedSave.commander.id);
  assert.equal(reloadedDestination.commander?.xp, deployedSave.commander.xp);
  assert.equal(await page.evaluate(() => Boolean((window as any).__settlement.simulation.adventure())), true,
    "A full page reload must resume the active expedition destination");
  report.destinationReload = reloadedDestination;
  const fightResult = await fight(page, 3000);
  assert.equal(fightResult.cleared, true, `adventure fight must clear: ${JSON.stringify(fightResult)}`);
  await page.waitForTimeout(700);
  await screenshot(page, quality, "17-after-battle");
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible", timeout: 20_000 });
  const popupText = await popup.innerText();
  assert.match(popupText, /Adventure won!/);
  await screenshot(page, quality, "18-victory-popup");
  const victory = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    const battle = simulation.adventure()?.battle;
    return { adventure: simulation.adventure(), battle, commander, deaths: simulation.militaryDeaths(),
      sameResult: simulation.awardCommanderExperience(commander.lastXpResult) };
  });
  const awardDelta = victory.commander.xp - 30;
  assert.ok(awardDelta === 1 || awardDelta === 2, `unexpected commander victory XP delta: ${awardDelta}`);
  assert.equal(victory.sameResult, false);
  assert.equal(victory.deaths.some((death: any) => death.id === landing.soldier.actor), false);
  const postVictorySave = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const save = simulation.saveState();
    const loaded = simulation.loadState(save);
    return { adventure: save.adventure?.status, loaded, commander: simulation.commanderSnapshot() };
  });
  report.xpAwardDelta = awardDelta;
  assert.equal(postVictorySave.adventure, "won");
  if (!postVictorySave.loaded.ok) report.postVictorySaveError = postVictorySave.loaded.reason;
  // The natural fight often incapacitates; otherwise force a consistent casualty for the sea pickup.
  await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const commander = simulation.commanderSnapshot();
    if (commander.location === "awaiting-evacuation") return;
    const save = simulation.saveState();
    const soldier = save.military.soldiers.find((entry: any) => entry.commanderId === commander.id);
    const actor = save.actors.find((entry: any) => entry.uid === soldier?.actor);
    if (!soldier || !actor) throw new Error("commander casualty fixture missing");
    soldier.combat = { ...soldier.combat, hp: 0 };
    Object.assign(actor, { mounted: false, phase: "commanderIncapacitated", visible: false });
    save.military.commander = { ...save.military.commander, awayHp: 0, location: "awaiting-evacuation",
      transport: { destinationName: simulation.adventure()?.island.name ?? "Adventure",
        operationId: commander.operationId ?? 1, phase: "awaiting-evacuation" } };
    const loaded = simulation.loadState(save);
    if (!loaded.ok) throw new Error(`casualty load failed: ${loaded.reason}`);
    simulation.update(.1);
  });
  const casualty = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { commander: simulation.commanderSnapshot(), state: simulation.commanderState(),
      transport: simulation.commanderTransport(),
      soldier: simulation.militarySoldiers().find((entry: any) => entry.commanderId === simulation.commanderSnapshot()?.id) };
  });
  assert.ok(casualty.commander, "the commander must survive as an evacuation record");
  assert.equal(casualty.commander.location, "awaiting-evacuation");
  if (casualty.transport) assert.equal(casualty.transport.phase, "awaiting-evacuation");
  await screenshot(page, quality, "19-destination-casualty");
  await popup.getByRole("button", { name: "Sail home", exact: true }).click();
  await page.waitForFunction(() => Boolean((window as any).__settlement?.simulation.home() &&
    !(window as any).__settlement.simulation.colony() && !(window as any).__settlement.simulation.adventure()), null,
    { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
  await page.waitForTimeout(1000);
  const home = await commanderState(page);
  report.homeCasualtyArrival = home;
  assert.equal(home.commander.location, "recovering");
  assert.ok(home.commander.hp >= 1 && home.commander.hp <= 1 + home.commander.maximumHp * .011,
    `first observed home casualty HP must be 1 after at most one 1% heal: ${home.commander.hp}`);
  assert.equal(home.commander.xp, victory.commander.xp);
  assert.ok(home.commander.recoverySeconds <= 1800 + 1e-6 && home.commander.recoverySeconds > 0,
    `home casualty recovery must remain bounded after loading: ${home.commander.recoverySeconds}`);
  assert.ok(Number.isSafeInteger(home.soldier.combat.mount));
  assert.equal(home.mount.phase, "horseMounted");
  report.expedition = { battleBefore, casualty, deployedSave, fightResult, followed, home, landing, muster,
    popupText, postVictorySave, resumeOutward, sailed, savedDestination, victory };
};

const runRecovery = async (page: Page, quality: string, fixture: Fixture, report: Record<string, unknown>) => {
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  await page.locator(".settlement-ui__commander").waitFor({ state: "visible", timeout: 10_000 });
  await sectionShot(page, quality, ".settlement-ui__commander", "20-home-casualty");
  const before = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { commander: simulation.commanderSnapshot(), state: simulation.commanderState() };
  });
  await advance(page, 60);
  const afterMinute = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { commander: simulation.commanderSnapshot(), state: simulation.commanderState() };
  });
  assert.ok(Math.abs((before.state.recoverySeconds - afterMinute.state.recoverySeconds) - 60) < .2);
  assert.ok(Math.abs((afterMinute.commander.hp - before.commander.hp) -
    before.commander.maximumHp * .01) < .2);
  await advance(page, 30 * 60 - 60);
  const recovered = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { commander: simulation.commanderSnapshot(), state: simulation.commanderState() };
  });
  assert.equal(recovered.commander.recoveryComplete, true);
  assert.equal(recovered.commander.ready, false);
  assert.equal(recovered.commander.blockReason, "too-injured");
  assert.ok(recovered.commander.hp < recovered.commander.maximumHp * .5);
  await sectionShot(page, quality, ".settlement-ui__commander", "21-home-recovery-complete");
  const gatePlanner = await openPlanner(page, fixture.harbour, "adventure");
  const gateCard = gatePlanner.locator("[data-commander-card]").filter({ hasText: "Astrid" });
  assert.match(await gateCard.innerText(), /Too injured|Recovering/);
  await sectionShot(page, quality, ".colony-planner__commanders", "22-planner-post-recovery-gate");
  await closePlanner(page);
  const heal = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 20 * 3600 && !simulation.commanderSnapshot().ready; tick++) simulation.update(.05);
    return { commander: simulation.commanderSnapshot(), state: simulation.commanderState() };
  });
  assert.equal(heal.commander.ready, true);
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  await page.locator(".settlement-ui__commander").waitFor({ state: "visible", timeout: 10_000 });
  await sectionShot(page, quality, ".settlement-ui__commander", "23-home-ready-50pct");
  const beforeDemolish = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { commander: simulation.commanderSnapshot(), save: simulation.saveState() };
  });
  const missing = await page.evaluate(lodge => {
    const simulation = (window as any).__settlement.simulation;
    const demolished = simulation.demolishBuilding(lodge.uid);
    for (let tick = 0; tick < 20 * 300; tick++) simulation.update(.05);
    return { demolished, commander: simulation.commanderSnapshot(), state: simulation.commanderState() };
  }, fixture.lodge);
  assert.equal(missing.demolished.ok, true);
  assert.equal(missing.commander.blockReason, "missing-home");
  assert.equal(missing.commander.hp, beforeDemolish.commander.hp);
  assert.equal(missing.commander.recoverySeconds, beforeDemolish.commander.recoverySeconds);
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7).catch(() => undefined);
  await sectionShot(page, quality, ".settlement-ui__commander", "24-missing-lodge-paused").catch(() => undefined);
  await page.evaluate(save => {
    const simulation = (window as any).__settlement.simulation;
    if (!simulation.loadState(save).ok) throw new Error("restore lodge load failed");
  }, beforeDemolish.save);
  report.recovery = { afterMinute, before, beforeDemolish: { commander: beforeDemolish.commander },
    heal, missing, recovered };
};

const runLivingReturn = async (page: Page, quality: string, fixture: Fixture, commanderId: string,
  report: Record<string, unknown>) => {
  await closeBuildingDetails(page);
  await page.evaluate(harbour => {
    const simulation = (window as any).__settlement.simulation;
    const building = simulation.buildings().find((entry: any) => entry.uid === harbour.uid);
    Object.assign(building.inventory, { hammer: 2, planks: 40, shovel: 2, stone: 30 });
  }, fixture.harbour);
  const colony = await openPlanner(page, fixture.harbour, "colony");
  const easy = await page.evaluate(() => (window as any).__settlement.simulation.colonyIslands()
    .filter((island: any) => island.difficulty === "easy")
    .sort((a: any, b: any) => a.voyageSeconds - b.voyageSeconds)[0]);
  await colony.locator(`[data-colony-island="${easy.id}"]`).click();
  await chooseCommander(page, colony, commanderId);
  await setTroops(page, colony, 8);
  await colony.getByRole("button", { name: "Start expedition", exact: true }).click();
  await page.waitForTimeout(800);
  const sailed = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    for (let tick = 0; tick < 20 * 5000 && simulation.colonyExpeditions()[0]?.status !== "arrived"; tick++)
      simulation.update(.05);
    return { expedition: simulation.colonyExpeditions()[0], transport: simulation.commanderTransport() };
  });
  assert.equal(sailed.expedition.status, "arrived");
  const visit = page.locator("[data-colony-visit]").first();
  await visit.waitFor({ state: "visible", timeout: 30_000 });
  await visit.click();
  await page.waitForFunction(() => Boolean((window as any).__settlement?.simulation.colony()), null,
    { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
  await page.waitForTimeout(1000);
  const landed = await page.evaluate(() => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    for (let tick = 0; tick < 20 * 2000 && simulation.commanderTransport()?.location !== "field"; tick++)
      simulation.update(.05);
    const commander = simulation.commanderSnapshot();
    const save = simulation.saveState();
    save.military.soldiers = save.military.soldiers.map((soldier: any) => soldier.commanderId
      ? { ...soldier, combat: { ...soldier.combat!, hp: commander.maximumHp * .2 } } : soldier);
    if (!simulation.loadState(save).ok) throw new Error("living low-HP load failed");
    const soldier = simulation.militarySoldiers().find((entry: any) => entry.commanderId === commander?.id);
    const actor = simulation.frames().find((entry: any) => entry.uid === soldier?.actor);
    if (actor) settlement.focusGround(actor.x, actor.z, 1.8);
    return { colony: simulation.colony(), commander: simulation.commanderSnapshot(),
      soldier, transport: simulation.commanderTransport() };
  });
  assert.equal(landed.commander.hp, landed.commander.maximumHp * .2);
  assert.equal(landed.transport.canReturn, true);
  assert.equal(await flushSave(page), true);
  const branchBase = await page.evaluate(async () => {
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    return (await openLocalSaveStore()).readSavedGame();
  });
  assert(branchBase);
  writeFileSync(resolve(output, `${quality}-colony-branch.json`), JSON.stringify(branchBase));
  await screenshot(page, quality, "25-colony-living-lowhp");
  const returnButton = page.locator("[data-commander-return]").first();
  await returnButton.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await returnButton.isDisabled(), false);
  await returnButton.click();
  const returning = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const seen: string[] = [];
    let troopShip: any = null;
    for (let tick = 0; tick < 20 * 4000; tick++) {
      simulation.update(.05);
      const transport = simulation.commanderTransport();
      const phase = transport?.phase ?? "none";
      if (seen[seen.length - 1] !== phase) seen.push(phase);
      const ship = simulation.ships().find((entry: any) => entry.troopRecall);
      if (ship) troopShip = ship;
      if (!transport) break;
    }
    return { commander: simulation.commanderTransport(),
      soldiers: simulation.militarySoldiers().filter((entry: any) => entry.commanderId).length, seen, troopShip };
  });
  assert.ok(returning.seen.includes("returning"));
  assert.equal(returning.commander, undefined);
  assert.equal(returning.soldiers, 0);
  assert.ok(returning.troopShip);
  const crossIslandRecruitment = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const lodge = simulation.debugRaiseBuilding(62);
    const allowsLodge = simulation.allowsBuilding(62);
    if (!lodge.ok && allowsLodge) throw new Error(`Destination lodge fixture: ${lodge.reason}`);
    const uid = lodge.building?.uid ?? -1;
    const status = simulation.commanderRecruitStatus(uid);
    const before = simulation.saveState();
    const refused = simulation.recruitCommander(uid);
    const after = simulation.saveState();
    return { allowsLodge, catalogueRefusal: lodge.reason, afterPeople: after.settlers, beforePeople: before.settlers,
      afterStock: after.buildings.map((entry: any) => entry.inventory),
      beforeStock: before.buildings.map((entry: any) => entry.inventory), refused, status };
  });
  assert.equal(crossIslandRecruitment.refused.ok, false);
  if (crossIslandRecruitment.allowsLodge)
    assert.match(crossIslandRecruitment.status.reason, /Another island already has your commander/);
  else assert.match(crossIslandRecruitment.refused.reason, /completed Commander's Lodge/);
  assert.equal(crossIslandRecruitment.afterPeople, crossIslandRecruitment.beforePeople);
  assert.deepEqual(crossIslandRecruitment.afterStock, crossIslandRecruitment.beforeStock);
  report.crossIslandRecruitment = crossIslandRecruitment;
  await screenshot(page, quality, "26-colony-returning");
  const homeButton = page.getByRole("button", { name: "Return to the home island", exact: true });
  await homeButton.waitFor({ state: "visible", timeout: 10_000 });
  await homeButton.click();
  await page.waitForFunction(() => Boolean((window as any).__settlement?.simulation.home() &&
    !(window as any).__settlement.simulation.colony() && !(window as any).__settlement.simulation.adventure()), null,
    { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
  await page.waitForTimeout(1000);
  const home = await commanderState(page);
  assert.equal(home.commander.location, "lodge");
  // A native page transition may cross an eligible one-minute 1% Lodge healing step.
  assert(home.commander.hp >= landed.commander.maximumHp * .2 && home.commander.hp < home.commander.maximumHp * .5);
  assert.equal(home.commander.recoverySeconds, 0);
  assert.equal(home.commander.blockReason, "too-injured");
  assert.ok(Number.isSafeInteger(home.soldier.combat.mount));
  assert.equal(home.mount.phase, "horseMounted");
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  await page.locator(".settlement-ui__commander").waitFor({ state: "visible", timeout: 10_000 });
  await sectionShot(page, quality, ".settlement-ui__commander", "27-home-living-return");
  // Clean the idle colony and report its ordinary survivor handoff.
  const disband = await page.evaluate(async () => {
    const button = document.querySelector(".colony-tracker__disband") as HTMLButtonElement | null;
    return { count: document.querySelectorAll(".colony-tracker__disband").length, found: Boolean(button) };
  });
  let disbanded: unknown = disband;
  if (disband.found) {
    await page.locator(".colony-tracker__disband").first().click();
    const popup = page.locator(".settlement-popup__dialog");
    await popup.waitFor({ state: "visible", timeout: 10_000 });
    await popup.getByRole("button", { name: "Disband", exact: true }).click();
    await page.waitForTimeout(1500);
    disbanded = await page.evaluate(() => ({
      colonies: (window as any).__settlement.simulation.colonyIslands().filter((island: any) => island.taken).length,
      stored: (window as any).__settlement.simulation.militaryStoredTroops()
        .reduce((sum: number, entry: any) => sum + entry.count, 0)
    }));
  }
  report.livingReturn = { disbanded, home, landed, returning, sailed };
  return branchBase;
};

/** Independent native continuations from the same deployed colony checkpoint. */
const runColonyResiduals = async (page: Page, quality: string, checkpoint: unknown,
  report: Record<string, unknown>) => {
  const restore = async () => {
    await Promise.all([page.waitForEvent("load"), page.evaluate(async value => {
      const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      (value as any).savedAt = Date.now();
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(value));
      location.reload();
    }, checkpoint)]);
    await ready(page);
    assert.equal(await page.evaluate(() => Boolean((window as any).__settlement.simulation.colony())), true);
  };
  const goHome = async () => {
    await page.getByRole("button", { exact: true, name: "Return to the home island" }).click();
    await page.waitForFunction(() => Boolean((window as any).__settlement?.simulation.home() &&
    !(window as any).__settlement.simulation.colony() && !(window as any).__settlement.simulation.adventure()), null,
      { timeout: 180_000 });
    await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 180_000 });
  };
  await restore();
  const pickup = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation, save = simulation.saveState();
    const commander = save.military.commander;
    const soldier = save.military.soldiers.find((entry: any) => entry.commanderId === commander.id);
    const actor = save.actors.find((entry: any) => entry.uid === soldier.actor);
    soldier.combat.hp = 0;
    Object.assign(actor, { mounted: false, phase: "commanderIncapacitated", visible: false });
    Object.assign(commander, { awayHp: 0, location: "awaiting-evacuation",
      transport: { ...commander.transport, phase: "awaiting-evacuation" } });
    const loaded = simulation.loadState(save);
    if (!loaded.ok) throw new Error(loaded.reason);
    const seen: string[] = [];
    let troopShip = false;
    for (let tick = 0; tick < 80_000; tick++) {
      simulation.update(.05);
      const transport = simulation.commanderTransport();
      const phase = transport?.phase ?? "none";
      if (seen.at(-1) !== phase) seen.push(phase);
      troopShip ||= simulation.ships().some((ship: any) => ship.troopRecall);
      if (!transport) break;
    }
    return { commander: simulation.commanderTransport(), seen, troopShip };
  });
  assert.equal(pickup.commander, undefined);
  assert(pickup.troopShip, "A colony casualty must use a real pickup ship");
  assert(pickup.seen.includes("returning"));
  await goHome();
  const casualtyHome = await commanderState(page);
  assert.equal(casualtyHome.commander.location, "recovering");
  assert(casualtyHome.commander.hp >= 1 && casualtyHome.commander.hp < casualtyHome.commander.maximumHp * .5);
  assert(casualtyHome.commander.recoverySeconds > 0 && casualtyHome.commander.recoverySeconds <= 1800 + 1e-6);
  await screenshot(page, quality, "30-colony-casualty-home");
  report.colonyCasualtyPickup = { casualtyHome, pickup };

  await restore();
  const deployed = await commanderState(page);
  await goHome();
  await page.locator(".colony-tracker__disband").first().click();
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible" });
  await popup.getByRole("button", { exact: true, name: "Disband" }).click();
  await advance(page, 4000);
  await page.waitForTimeout(1000);
  const survivorHome = await commanderState(page);
  assert.equal(survivorHome.commander.id, deployed.commander.id);
  assert.equal(survivorHome.commander.location, "lodge");
  assert.equal(survivorHome.commander.xp, deployed.commander.xp);
  assert(survivorHome.commander.hp > 0);
  await screenshot(page, quality, "31-colony-survivor-receipt-home");
  report.colonySurvivorReceipt = { deployed, survivorHome };
};

/** Native startup with a legitimate player-wide marker belonging to another island. */
const runNativePlayerWideRefusal = async (page: Page, quality: string, fixture: Fixture,
  report: Record<string, unknown>) => {
  await flushSave(page);
  const baseline = await page.evaluate(async () => {
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    return (await openLocalSaveStore()).readSavedGame();
  });
  assert(baseline);
  writeFileSync(resolve(output, `${quality}-finished-home.json`), JSON.stringify(baseline));
  await Promise.all([page.waitForEvent("load"), page.evaluate(async source => {
    const military = source.settlement.military;
    const removed = new Set(military.soldiers.filter((soldier: any) => soldier.commanderId)
      .flatMap((soldier: any) => [soldier.actor, soldier.combat?.mount]));
    military.soldiers = military.soldiers.filter((soldier: any) => !soldier.commanderId);
    delete military.commander;
    source.settlement.actors = source.settlement.actors.filter((actor: any) => !removed.has(actor.uid));
    source.player.commander = { homeIslandSeed: source.settlement.world.seed + 1, id: "native-other-island-commander" };
    source.savedAt = Date.now();
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(source));
    location.reload();
  }, baseline as any)]);
  await ready(page);
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  const card = page.locator(".settlement-ui__commander");
  await card.waitFor({ state: "visible" });
  const text = await card.innerText();
  const trigger = card.getByRole("button", { exact: true, name: "Recruit commander" });
  assert.match(await trigger.getAttribute("title") ?? "", /Another island already has your commander/);
  assert.equal(await trigger.isDisabled(), true);
  const refusal = await page.evaluate(uid => {
    const simulation = (window as any).__settlement.simulation;
    const before = simulation.saveState();
    const result = simulation.recruitCommander(uid);
    const after = simulation.saveState();
    return { beforePeople: before.settlers, afterPeople: after.settlers,
      beforeStock: before.buildings.map((building: any) => building.inventory),
      afterStock: after.buildings.map((building: any) => building.inventory), result };
  }, fixture.lodge.uid);
  assert.deepEqual(refusal.result, { ok: false, reason: "Another island already has your commander" });
  assert.equal(refusal.beforePeople, refusal.afterPeople);
  assert.deepEqual(refusal.beforeStock, refusal.afterStock);
  await sectionShot(page, quality, ".settlement-ui__commander", "32-player-wide-refusal");
  report.nativePlayerWideRefusal = { refusal, text, provenance: "Native full-save startup with foreign player commander marker" };
};

const runThresholdLevel3 = async (page: Page, quality: string, fixture: Fixture,
  report: Record<string, unknown>) => {
  await page.evaluate(lodge => {
    const simulation = (window as any).__settlement.simulation;
    simulation.levelUpCommander(lodge.uid);
  }, fixture.lodge);
  await clickGround(page, fixture.lodge.x, fixture.lodge.z, 1.7);
  const card = page.locator(".settlement-ui__commander");
  await card.waitFor({ state: "visible", timeout: 10_000 });
  const text = await card.innerText();
  const state = await commanderState(page);
  assert.match(text, /Level 3/);
  assert.equal(await page.locator('.settlement-ui__commander [data-rank-level="3"]').count(), 1);
  assert.equal(state.commander.xp, 100);
  await sectionShot(page, quality, ".settlement-ui__commander", "28-lodge-card-level3");
  report.level3 = { state, text };
};

const runJourney = async (quality: string) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  const fixture = await createFixture(page);
  const resume = process.env.RESUME;
  const resumeStage = process.env.RESUME_STAGE ?? "recovery";
  let previous: Record<string, any> | undefined;
  if (resume) {
    previous = JSON.parse(readFileSync(resolve(output, `journey-${quality}.json`), "utf8"));
    const source = JSON.parse(readFileSync(resume, "utf8"));
    source.savedAt = Date.now();
    await page.evaluate(async value => {
      const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(value));
    }, source);
  }
  await page.goto(`${url}?quality=${quality}`);
  await ready(page);
  const fog = await page.evaluate(async () => {
    const path = "/src/app/settings/graphics-settings.ts";
    return (await import(/* @vite-ignore */ path)).settingsStorage.readFog();
  });
  assert.equal(fog, false);
  const report: Record<string, unknown> = { ...previous, errors, fixture, quality };
  if (resume) report.continuation = { source: resume, stage: resumeStage };
  delete report.error;
  try {
    if (resume && resumeStage === "colony") {
      await runColonyResiduals(page, quality, JSON.parse(readFileSync(resume, "utf8")), report);
    } else {
    if (!resume) {
      await runLodge(page, quality, fixture, report);
      if (process.env.LODGE_ONLY === "1") { report.lodgeOnly = true; return; }
      const commander = await page.evaluate(() => (window as any).__settlement.simulation.commanderSnapshot());
      await runPlanner(page, quality, fixture, commander.id, report);
      const easy = await page.evaluate(() => (window as any).__settlement.simulation.adventureIslands()
        .find((island: any) => island.difficulty === "easy"));
      await runExpedition(page, quality, fixture, easy, commander.id, report);
    } else if (resumeStage === "outward") {
      const commander = await page.evaluate(() => (window as any).__settlement.simulation.commanderSnapshot());
      const easy = await page.evaluate(() => (window as any).__settlement.simulation.adventureIslands()
        .find((island: any) => island.difficulty === "easy"));
      await runExpedition(page, quality, fixture, easy, commander.id, report, true);
    }
    const commander = await page.evaluate(() => (window as any).__settlement.simulation.commanderSnapshot());
    if (resumeStage !== "living") await runRecovery(page, quality, fixture, report);
    const colonyCheckpoint = await runLivingReturn(page, quality, fixture, commander.id, report);
    await runThresholdLevel3(page, quality, fixture, report);
    await screenshot(page, quality, "29-final-home");
    await runColonyResiduals(page, quality, colonyCheckpoint, report);
    }
    if (quality === "high") await runNativePlayerWideRefusal(page, quality, fixture, report);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    await screenshot(page, quality, "99-failure").catch(() => undefined);
    throw error;
  } finally {
    const checkpoint = await page.evaluate(async () => {
      await (window as any).__settlement.saving.flush("manual");
      const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
      return (await openLocalSaveStore()).readSavedGame();
    }).catch(() => null);
    if (checkpoint) writeFileSync(resolve(output, `checkpoint-${quality}.json`), JSON.stringify(checkpoint));
    report.errors = errors;
    if (errors.length) allErrors.push(...errors.map(error => `${quality}: ${error}`));
    receipts.push(report);
    writeFileSync(resolve(output, `journey-${quality}.json`), `${JSON.stringify(report, null, 2)}\n`);
    await page.close();
  }
};

try {
  if (process.env.PREFLIGHT_ONLY === "1") {
    const page = await browser.newPage();
    await page.addInitScript("window.__name=value=>value;");
    await page.routeWebSocket("**/*", () => {});
    console.log(JSON.stringify(await createFixture(page)));
    await page.close();
  } else for (const quality of qualities) await runJourney(quality);
  writeFileSync(resolve(output, "journey.json"), `${JSON.stringify({ errors: allErrors, receipts }, null, 2)}\n`);
  console.log(JSON.stringify(receipts.map(receipt => ({ errors: receipt.errors, quality: receipt.quality,
    xp: (receipt.expedition as any)?.victory?.commander?.xp })), null, 1));
  assert.deepEqual(allErrors, []);
} finally {
  await browser.close();
  await server.close();
}
