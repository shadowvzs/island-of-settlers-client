import { adventureExperience, adventurePoints } from "@shared/catalog/balance";
import { describe, expect, it, vi } from "vitest";

import { getSettlementUiSnapshot } from "../src/app/settlement/settlement-ui-state";
import { banditCampPlan, banditSiteName } from "../src/render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { BUILDING_MENU } from "../src/render-common/buildings/building-menu";
import { COLONY_DIFFICULTIES } from "../src/shared/balance/colonies";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { colonyConquestReward, colonyFortPlans } from "../src/shared/settlement/colony-island-rules";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import { reachableCells } from "../src/shared/settlement/settlement-colony";
import { ORE } from "../src/shared/world/world-data";
import { colony, troops } from "./helpers/colony-simulation";
import { clearEnemySoldiers, fakeColonyConquest } from "./helpers/fake-colony-conquest";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const islands = colonyIslandOffers(1234);
type Simulation = ReturnType<typeof colony>["simulation"];
/** Every fort falls at once (their destruction is covered in colony-fort-assault.test.ts); the colony is conquered. */
const conquer = (simulation: Simulation) => fakeColonyConquest(simulation);
/** Cards the build menu offers, by building id. */
const menuIds = (simulation: Simulation) => BUILDING_MENU.flatMap(group => group.buildings)
  .map(building => building.id).filter(id => id !== 0 && simulation.allowsBuilding(id)).sort((a, b) => a - b);
/** The first plot near the harbour where the building fits inside the territory. */
const placeNearHarbour = (simulation: Simulation, typeId: number) => {
  const home = simulation.headquarters, [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  for (let ring = 6; ring < 20; ring++) for (let step = 0; step < 24; step++) {
    const angle = step * Math.PI / 12;
    const x = Math.round(home.x + Math.cos(angle) * ring) + width % 2 / 2;
    const z = Math.round(home.z + Math.sin(angle) * ring) + depth % 2 / 2;
    const placed = simulation.placeBuilding(typeId, x, z);
    if (placed.ok && simulation.connectRoads(home.access, placed.building!.access)) return placed.building!;
    if (placed.ok) simulation.demolishBuilding(placed.building!.uid);
  }
  return null;
};

describe("colony islands", () => {
  it("generates a 96 x 96 island whose deposits all hold the island's ore", () => {
    const island = islands.find(entry => entry.ore === "ironOre")!;
    const world = chooseColonyWorld(island);
    expect([world.cellsX, world.cellsZ]).toEqual([96, 96]);
    const deposits = world.mineZones.filter(zone => zone.ore !== ORE.none);
    expect(deposits.length).toBeGreaterThan(0);
    expect(deposits.every(zone => zone.ore === ORE.iron && zone.surveyed)).toBe(true);
  }, 30000);

  it.each(["easy", "medium", "hard"] as const)("lands the party and garrisons %s forts", difficulty => {
    const island = islands.find(entry => entry.difficulty === difficulty)!;
    const { simulation, world } = colony(island);
    expect(simulation.headquarters).toMatchObject({ colonyHome: true, typeId: 39 });
    expect(simulation.startColony({ island, landed: { planks: 20, shovel: 1 }, troops: troops(6) }))
      .toEqual({ ok: true });
    const { enemyBuildings: forts, enemyTroops: defenders } = COLONY_DIFFICULTIES[difficulty];
    expect(simulation.colony()).toMatchObject({ forts, hostileForts: forts, status: "contested" });
    const hostile = simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 1);
    expect(hostile).toHaveLength(defenders);
    const sites = simulation.buildings().filter(site => site.militaryFaction === 1);
    expect(sites.every(site => site.enemyCampEnclosure === "building")).toBe(true);
    const legacy = simulation.saveState();
    for (const site of legacy.buildings) delete site.enemyCampEnclosure;
    expect(simulation.loadState(legacy)).toEqual({ ok: true });
    expect(simulation.buildings().filter(site => site.militaryFaction === 1)
      .every(site => site.enemyCampEnclosure === "building")).toBe(true);
    expect(hostile.every(soldier => soldier.stationed)).toBe(true);
    // Every defender was raised on ground the landed troops can walk to (no isolated rock or spit).
    const context = { occupied: new Uint8Array(world.cellsX * world.cellsZ), options: { world } };
    const reachable = reachableCells(context as never, simulation.headquarters.access);
    const bodies = simulation.frames().filter(actor => hostile.some(soldier => soldier.actor === actor.uid));
    expect(bodies.every(body => reachable(body))).toBe(true);
    expect(simulation.militaryStoredTroops().find(entry => entry.type === "shield")!.count).toBe(6);
    expect(simulation.headquarters.inventory).toMatchObject({ planks: 20, shovel: 1 });
    expect(simulation.availableSettlers()).toBe(2);
  }, 30000);

  it("stays contested while a removed fort's garrison fights on, and is conquered when none is alive", () => {
    const island = islands.find(entry => entry.difficulty === "easy")!;
    const { simulation } = colony(island, () => 5000);
    simulation.startColony({ island, landed: {}, troops: troops(3) });
    for (const fort of simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0))
      expect(simulation.removeMilitaryScenarioBuilding(fort.uid).ok).toBe(true);
    for (let tick = 0; tick < 20; tick++) simulation.update(.05);
    // Owner 2026-11-09: the garrison comes out and keeps fighting; no fort left is not yet a conquest.
    const enemies = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);
    expect(enemies.length).toBeGreaterThan(0);
    const fielded = new Set(simulation.frames().filter(actor => actor.phase === "militaryField").map(actor => actor.uid));
    expect(enemies.every(soldier => fielded.has(soldier.actor))).toBe(true);
    expect(simulation.colony()).toMatchObject({ hostileForts: 0, status: "contested" });
    clearEnemySoldiers(simulation);
    simulation.update(.05);
    expect(simulation.colony()?.status).toBe("conquered");
  }, 30000);

  it("allows only military plots until every fort is taken, then military, mines and food buildings", () => {
    const island = islands.find(entry => entry.difficulty === "easy")!;
    let clock = 5000;
    const { simulation } = colony(island, () => clock);
    simulation.startColony({ island, landed: {}, troops: troops(3) });
    expect(menuIds(simulation)).toEqual([1, 2, 4, 9, 14]);
    expect(simulation.placeBuilding(17, 40, 40)).toMatchObject({
      ok: false, reason: "Only military plots until every enemy fort is taken" });
    const saved = simulation.saveState();
    expect(saved.colony).toMatchObject({ forts: 3, status: "contested" });
    expect(getSettlementUiSnapshot(simulation, []).buildingMenuBlocked).toBe(true);
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    clock = 9000;
    conquer(simulation);
    expect(simulation.colony()).toMatchObject({ conqueredAt: 9000, hostileForts: 0, status: "conquered" });
    expect(getSettlementUiSnapshot(simulation, []).buildingMenuBlocked).toBe(false);
    // Owner 2026-10-13: military plots, the four mines and the miners' food chain; the harbour is the store.
    // Owner 2026-10-18: the one shared sawmill (33) is also built on colonies.
    const economy = [1, 2, 4, 9, 10, 11, 12, 13, 14, 18, 21, 22, 28, 31, 32, 33, 35, 37, 41, 42, 43, 57, 58, 59];
    expect(menuIds(simulation)).toEqual(economy);
    for (const refused of [5, 6, 17, 29, 40])
      expect(simulation.placeBuilding(refused, 40, 40)).toMatchObject({ ok: false,
        reason: "Colonies build military, mine, food, residence and advanced resource buildings" });
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
    expect(menuIds(simulation)).toEqual(economy);
  }, 30000);

  it("runs a production building with carriers and roads on a conquered colony", () => {
    const island = islands.find(entry => entry.difficulty === "easy")!;
    const { simulation } = colony(island, () => 5000, 8);
    simulation.startColony({ island, landed: { hammer: 1, planks: 30, shovel: 1, stone: 20 }, troops: troops(3) });
    conquer(simulation);
    const well = placeNearHarbour(simulation, 35);
    expect(well).not.toBeNull();
    for (let tick = 0; tick < 20 * 600 && well!.construction < 1; tick++) simulation.update(.05);
    expect(well!.construction, well!.status).toBe(1);
    for (let tick = 0; tick < 20 * 240; tick++) simulation.update(.05);
    expect(simulation.frames().some(actor => actor.job === "Well worker")).toBe(true);
    expect(simulation.resourceTotal("water")).toBeGreaterThan(0);
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 60000);

  it("labels enemy forts with their defenders and refuses to demolish the harbour by its own name", () => {
    const island = islands.find(entry => entry.difficulty === "easy")!;
    const { simulation } = colony(island);
    simulation.startColony({ island, landed: {}, troops: troops(3) });
    for (let tick = 0; tick < 4; tick++) simulation.update(.5);
    const forts = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
    for(const fort of forts){
      const plan = banditCampPlan(fort.bandit!);
      const count=simulation.colony()!.fortStates.find(state=>state.uid===fort.uid)!.defenders;
      expect(fort.status).toContain(`${plan.tier} · ${banditSiteName(fort.bandit!, fort.enemyCampEnclosure)}`);
      expect(fort.status).toContain(`${count} defender`);
      expect(fort.status).toContain(`capacity ${plan.capacity}`);
    }
    expect(simulation.colony()!.fortStates.reduce((sum, fort) => sum + fort.defenders, 0))
      .toBe(COLONY_DIFFICULTIES.easy.enemyTroops);
    expect(simulation.demolishBuilding(simulation.headquarters.uid)).toEqual({ ok: false,
      reason: "The harbour is this island's home and cannot be demolished" });
  });

  it("pays a small conquest experience: half an adventure against the same defenders", () => {
    for (const level of [5, 20, 50, 70]) {
      for (const difficulty of ["easy", "medium", "hard"] as const) {
        const units = colonyFortPlans(difficulty).flatMap(plan => plan.ranks.map(rank => ({ rank })));
        const adventure = adventureExperience(adventurePoints({ units }), level);
        expect(colonyConquestReward(difficulty, level)).toBeGreaterThan(0);
        expect(colonyConquestReward(difficulty, level)).toBeLessThanOrEqual(Math.ceil(adventure / 2));
      }
      expect(colonyConquestReward("hard", level)).toBeGreaterThan(colonyConquestReward("easy", level));
    }
  });

  it("moves a fort that cannot be manned to another plot instead of half setting up the island", () => {
    const island = islands.find(entry => entry.difficulty === "easy")!;
    const probe = colony(island).simulation;
    expect(probe.startColony({ island, landed: {}, troops: [] }).ok).toBe(true);
    const door = probe.buildings().find(building => (building.militaryFaction ?? 0) > 0)!.access;
    const { simulation } = colony(island);
    const actors = simulation.frames();
    for (let dz = -5.5; dz <= 5.5; dz += .3) for (let dx = -5.5; dx <= 5.5; dx += .3)
      actors.push({ uid: -1000 - actors.length, visible: true, x: door.x + dx, z: door.z + dz } as never);
    expect(simulation.startColony({ island, landed: { planks: 20 }, troops: troops(4) })).toEqual({ ok: true });
    const forts = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
    expect(forts).toHaveLength(3);
    expect(forts.every(fort => Math.hypot(fort.access.x - door.x, fort.access.z - door.z) > 1)).toBe(true);
    expect(simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === 1)
      .every(soldier => soldier.stationed)).toBe(true);
    expect(simulation.headquarters.inventory).toMatchObject({ planks: 20 });
  }, 60000);
});
