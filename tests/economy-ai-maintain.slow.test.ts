import { afterEach, describe, expect, it } from "vitest";

import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import {
  AI, aiTower, CATAPULT, hashOf, maintainIsland, maintainOf, pocket, POCKET, pool, RIVAL, runSeconds, runTicks,
  type Simulation, stationed, TIMEOUT, TOWER
} from "./helpers/maintain-island";

/** EAI2b: the `maintain` behaviours, run by the faction AI loop (EAI2a) of a map that gives faction 2 `maintain`. */
const TOWER_COST = getConstructionCost(TOWER, "roman");

/** Runs until a new tower of the faction stands finished on the original plot with a full garrison. */
const awaitManned = (simulation: Simulation, plot: { x: number; z: number }, fallen: number, clearers: Set<unknown>) =>
  runSeconds(simulation, 420, () => {
    for (const { clearer } of simulation.ruins())
      if (clearer !== undefined)
        clearers.add(simulation.snapshot().actors.find(actor => actor.uid === clearer)?.hostileCivilianFaction);
    const tower = aiTower(simulation);
    return tower !== undefined && tower.uid !== fallen && tower.construction === 1 && tower.x === plot.x &&
      tower.z === plot.z && stationed(simulation, tower.uid) === 3;
  });

afterEach(() => setVisionProbe(null));

describe("economy AI maintain (EAI2b)", () => {
  it("rebuilds a razed tower on its plot from depot stock, re-garrisons it, and stops when the stock runs out", () => {
    const { simulation, tower } = maintainIsland({ planks: 7, stone: 7 });
    const plot = { x: tower.x, z: tower.z }, playerStock = pool(simulation, 0), clearers = new Set<unknown>();
    expect(runSeconds(simulation, 30, () => stationed(simulation, tower.uid) === 3)).toBe(true);
    for (let cycle = 1; cycle <= 2; cycle++) {
      const fallen = aiTower(simulation)!.uid;
      expect(simulation.destroyBuilding(fallen)).toBe(true);
      expect(awaitManned(simulation, plot, fallen, clearers)).toBe(true);
      expect(pool(simulation, AI)).toMatchObject({ planks: 7 - cycle * TOWER_COST.planks!,
        stone: 7 - cycle * TOWER_COST.stone! });
    }
    expect(simulation.destroyBuilding(aiTower(simulation)!.uid)).toBe(true);
    runSeconds(simulation, 300);
    expect(aiTower(simulation)).toBeUndefined();
    expect(simulation.ruins()).toEqual([]);
    const rebuilds = maintainOf(simulation)?.rebuilds ?? [];
    expect(rebuilds).toHaveLength(1);
    // Backed off, not spinning: one refused try per 10..60 s.
    expect(rebuilds[0]!.attempts).toBeGreaterThan(2);
    expect(rebuilds[0]!.attempts).toBeLessThan(12);
    expect(pool(simulation, AI)).toMatchObject({ planks: 1, stone: 1 });
    expect(pool(simulation, 0)).toEqual(playerStock);
    // Every clearer seen at work was the faction's own settler.
    expect([...clearers]).toEqual([AI]);
  }, TIMEOUT);

  it("gives a faction a script wakes from `none` a real economy that rebuilds a razed tower", () => {
    const { simulation, tower } = maintainIsland({ planks: 7, stone: 7 }, { woken: true });
    expect(simulation.saveState().factionAi).toMatchObject([{ economy: true, faction: AI, mode: "maintain" }]);
    expect(runSeconds(simulation, 30, () => stationed(simulation, tower.uid) === 3)).toBe(true);
    expect(simulation.destroyBuilding(tower.uid)).toBe(true);
    expect(awaitManned(simulation, { x: tower.x, z: tower.z }, tower.uid, new Set())).toBe(true);
    expect(pool(simulation, AI)).toMatchObject({ planks: 7 - TOWER_COST.planks!, stone: 7 - TOWER_COST.stone! });
    const saved = JSON.parse(JSON.stringify(simulation.saveState()));
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(simulation.saveState().factionAi).toEqual(saved.factionAi);
  }, TIMEOUT);

  it("keeps the faction's clearers home while an enemy it sees stands near the ruin (A13 reads only)", () => {
    setVisionProbe("latest");
    const { simulation, tower, world } = maintainIsland({ planks: 7, stone: 7 }, { shape: pocket });
    runSeconds(simulation, 30);
    expect(simulation.destroyBuilding(tower.uid)).toBe(true);
    simulation.spawnMilitaryOpponent(POCKET, "heavy", 2, RIVAL);
    let seen = 0;
    runSeconds(simulation, 60, () => {
      if (simulation.factionVision().sees(AI, POCKET.x, POCKET.z)) seen++;
      expect(simulation.ruins().every(ruin => ruin.clearer === undefined)).toBe(true);
    });
    expect(simulation.ruins()).toHaveLength(1);
    expect(seen).toBeGreaterThan(55);
    const reads = visionProbeReport().find(site => site.site === "civilian.factionEnemyWithin");
    expect(reads?.reads).toBeGreaterThan(0);
    expect(reads?.unseen).toBe(0);
    expect(world.walkCost[Math.floor(POCKET.z) * world.cellsX + Math.floor(POCKET.x)]).toBeGreaterThan(0);
  }, TIMEOUT);

  it("refills a Catapult's ground stone with the faction's carriers from its depot", () => {
    const { simulation, tower } = maintainIsland({ stone: 12 }, { typeId: CATAPULT });
    const playerStock = pool(simulation, 0);
    expect(runSeconds(simulation, 240, () => (tower.catapultSupply?.ground ?? 0) > 0)).toBe(true);
    expect(pool(simulation, AI).stone).toBeLessThan(12);
    expect(pool(simulation, 0)).toEqual(playerStock);
  }, TIMEOUT);
});

describe("economy AI maintain determinism (EAI2b gates)", () => {
  it("decides the same at 0.05 s, 1/60 s and mixed frames", () => {
    const hashes = [[.05], [1 / 60], [.05, 1 / 60, .1, .03]].map(frames => {
      const { simulation, tower, world } = maintainIsland({ planks: 7, stone: 7 });
      runTicks(simulation, 600, frames);
      simulation.destroyBuilding(tower.uid);
      runTicks(simulation, 4400, frames);
      return hashOf(simulation, world);
    });
    expect(new Set(hashes).size).toBe(1);
  }, TIMEOUT);

  it("saves and reloads mid-rebuild and resumes identically", () => {
    const run = (reload: boolean) => {
      const { simulation, tower, world } = maintainIsland({ planks: 7, stone: 7 });
      runTicks(simulation, 600, [.05]);
      simulation.destroyBuilding(tower.uid);
      runTicks(simulation, 1500, [.05]);
      if (reload) {
        const saved = JSON.parse(JSON.stringify(simulation.saveState()));
        expect(maintainOf(simulation)?.rebuilds).toHaveLength(1);
        expect(simulation.loadState(saved)).toEqual({ ok: true });
      }
      runTicks(simulation, 4400, [.05]);
      return hashOf(simulation, world);
    };
    expect(run(true)).toBe(run(false));
  }, TIMEOUT);
});
