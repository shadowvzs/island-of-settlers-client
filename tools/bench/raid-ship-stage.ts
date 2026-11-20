type Page = import("playwright-core").Page;

/**
 * Shared staging of the colony raid-ship reviews (battle AI, pirate landing): a saved test colony
 * fixture, and a hard colony whose nearest fort the player holds, so the raid ship launches at once.
 */

/**
 * Direct saved-colony fixture: visual battle checks do not need to replay an unrelated voyage. `seed`: the
 * world seed whose island offers hold the colony.
 */
export const openColony = async (page: Page, url: string, quality: string, difficulty = "easy", seed = 1234) => {
  await page.evaluate(async ({ difficulty, seed }) => {
    const imp = (path: string) => import(/* @vite-ignore */ path);
    const { colonyIslandOffers } = await imp("/src/shared/settlement/colony-expedition-rules.ts");
    const { chooseColonyWorld } = await imp("/src/shared/settlement/colony-world-choice.ts");
    const { createRoadNetwork } = await imp("/src/shared/settlement/road-network.ts");
    const { createSettlementSimulation } = await imp("/src/shared/settlement/settlement-simulation.ts");
    const { createGameSave } = await imp("/src/shared/settlement/game-save.ts");
    const { openLocalSaveStore } = await imp("/src/app/save-store/local-save-store.ts");
    const island = colonyIslandOffers(seed).find((island: any) => island.difficulty === difficulty);
    const world = chooseColonyWorld(island);
    let simulation: any;
    const roads = createRoadNetwork(world, { isBlocked: (x: number, z: number) => simulation?.isOccupied(x, z) });
    simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39,
      initialSettlers: 2, initialStock: {}, roads, world });
    const troops = Array.from({ length: 4 }, () => ({ hp: 150, rank: 1, type: "heavy" }));
    const started = simulation.startColony({ island, landed: {}, troops });
    if (!started.ok) throw new Error(started.reason);
    const save = await createGameSave(world, simulation.saveState(), { animals: [], name: "Battle review",
      savedAt: Date.now(), source: "generated" });
    await (await openLocalSaveStore()).writeStartupGame(JSON.stringify(save));
  }, { difficulty, seed });
  await page.goto(`${url}?quality=${quality}&cache=0`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 120000 });
};

/**
 * Turns the open test colony hard and hands the player its nearest fort (two of the player's soldiers
 * garrison it): the raid ship launches on the next tick. `launches`: raid ships already sent.
 */
export const stageRaidShip = (page: Page, launches?: number) => page.evaluate(launches => {
  const simulation = (window as any).__settlement.simulation, home = simulation.home();
  const saved = simulation.saveState();
  saved.colony.island.difficulty = "hard";
  // Isolate the ship arrival from the independent land counterattack.
  saved.colony.counterattack = { landTime: 1000, launches, raiders: [], shipTime: .05 };
  const fort = saved.buildings.filter((building: any) => building.militaryFaction > 0)
    .sort((a: any, b: any) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
  const guards = new Set(saved.military.soldiers.filter((soldier: any) => soldier.building === fort.uid)
    .map((soldier: any) => soldier.actor));
  saved.military.soldiers = saved.military.soldiers.filter((soldier: any) => !guards.has(soldier.actor));
  saved.actors = saved.actors.filter((actor: any) => !guards.has(actor.uid));
  fort.militaryFaction = 0;
  for (const soldier of saved.military.soldiers.filter((s: any) => (s.combat?.faction ?? 0) === 0).slice(0, 2)) {
    const actor = saved.actors.find((a: any) => a.uid === soldier.actor);
    Object.assign(soldier, { building: fort.uid, stationed: true });
    Object.assign(actor, { building: fort.uid, path: [], pathIndex: 0, phase: "garrison", visible: false,
      x: fort.doorThreshold.x, z: fort.doorThreshold.z });
  }
  const door = saved.military.combat.doors.find((entry: any) => entry.building === fort.uid);
  if (door) door.faction = 0;
  const loaded = simulation.loadState(saved);
  return loaded.ok ? null : loaded.reason as string;
}, launches);
