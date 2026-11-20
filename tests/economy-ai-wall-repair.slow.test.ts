import { afterEach, describe, expect, it } from "vitest";

import { BUILDING_STRUCTURE_HP } from "../src/shared/balance/military";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import {
  AI, hashOf, maintainIsland, maintainOf, pocket, POCKET, pool, RIVAL, runSeconds, runTicks, type Simulation,
  stationed, TIMEOUT, TOWER
} from "./helpers/maintain-island";

/**
 * EAI2d: a `maintain` faction mends its own damaged walls with its own settlers and depot stock. The tower (type 2,
 * 20,000 HP, 3 planks + 3 stone) takes its walls with its first soldier; the player's damage leaves it standing.
 */
const MAXIMUM = BUILDING_STRUCTURE_HP[TOWER]!;
/** 15,000 HP lost: one trip of 10,000 HP (1 plank, 1 stone), one of 5,000 HP (shares round to 0: 1 plank). */
const DAMAGE = 15_000;

const wallsOf = (simulation: Simulation, uid: number) =>
  simulation.militaryDoors().find(door => door.building === uid)?.structure;
const repairers = (simulation: Simulation) => simulation.saveState().actors.filter(actor => actor.wallRepair);
const stockOf = (simulation: Simulation, ware: string) => pool(simulation, AI)[ware] ?? 0;

/** The island after the tower is manned and the player's blows took `DAMAGE` off its walls. */
const damagedIsland = (stock: Record<string, number>, shape?: Parameters<typeof maintainIsland>[1]) => {
  const island = maintainIsland(stock, shape);
  const { simulation, tower } = island;
  expect(runSeconds(simulation, 30, () => stationed(simulation, tower.uid) === 3)).toBe(true);
  expect(wallsOf(simulation, tower.uid)?.hp).toBe(MAXIMUM);
  expect(simulation.damageBuilding(tower.uid, DAMAGE)).toBe(true);
  expect(wallsOf(simulation, tower.uid)?.hp).toBe(MAXIMUM - DAMAGE);
  return island;
};

afterEach(() => setVisionProbe(null));

describe("economy AI wall repair (EAI2d)", () => {
  it("repairs a damaged wall to full HP from depot stock with its own settlers", () => {
    const { simulation, tower } = damagedIsland({ planks: 7, stone: 7 });
    const playerStock = pool(simulation, 0), owners = new Set<number | undefined>();
    const repaired = runSeconds(simulation, 240, () => {
      for (const actor of repairers(simulation)) owners.add(actor.hostileCivilianFaction);
      return wallsOf(simulation, tower.uid)?.hp === MAXIMUM && !repairers(simulation).length;
    });
    expect(repaired).toBe(true);
    expect(stockOf(simulation, "planks")).toBe(5);
    expect(stockOf(simulation, "stone")).toBe(6);
    expect(pool(simulation, 0)).toEqual(playerStock);
    expect([...owners]).toEqual([AI]);
    expect(maintainOf(simulation)).toBeUndefined();
  }, TIMEOUT);

  it("stops when the stock runs out, backing off without stalling", () => {
    const { simulation, tower } = damagedIsland({ planks: 1, stone: 1 });
    runSeconds(simulation, 300);
    expect(wallsOf(simulation, tower.uid)?.hp).toBe(MAXIMUM - DAMAGE + MAXIMUM / 2);
    expect(stockOf(simulation, "planks")).toBe(0);
    expect(stockOf(simulation, "stone")).toBe(0);
    expect(repairers(simulation)).toEqual([]);
    const [entry, ...others] = maintainOf(simulation)?.repairs ?? [];
    expect(others).toEqual([]);
    expect(entry?.uid).toBe(tower.uid);
    // One refused try per 10..60 s.
    expect(entry!.attempts).toBeGreaterThan(2);
    expect(entry!.attempts).toBeLessThan(12);
  }, TIMEOUT);

  it("sends nobody while an enemy it sees stands near the walls (A13 reads only)", () => {
    setVisionProbe("latest");
    const { simulation, tower } = damagedIsland({ planks: 7, stone: 7 }, { shape: pocket });
    simulation.spawnMilitaryOpponent(POCKET, "heavy", 2, RIVAL);
    runSeconds(simulation, 60, () => {
      expect(repairers(simulation)).toEqual([]);
    });
    expect(wallsOf(simulation, tower.uid)?.hp).toBe(MAXIMUM - DAMAGE);
    expect(stockOf(simulation, "planks")).toBe(7);
    const reads = visionProbeReport().find(site => site.site === "civilian.factionEnemyWithin");
    expect(reads?.reads).toBeGreaterThan(0);
    expect(reads?.unseen).toBe(0);
  }, TIMEOUT);
});

describe("economy AI wall repair determinism (EAI2d gates)", () => {
  it("repairs the same at 0.05 s, 1/60 s and mixed frames", () => {
    const hashes = [[.05], [1 / 60], [.05, 1 / 60, .1, .03]].map(frames => {
      const { simulation, tower, world } = maintainIsland({ planks: 7, stone: 7 });
      runTicks(simulation, 600, frames);
      expect(simulation.damageBuilding(tower.uid, DAMAGE)).toBe(true);
      runTicks(simulation, 3000, frames);
      return hashOf(simulation, world);
    });
    expect(new Set(hashes).size).toBe(1);
  }, TIMEOUT);

  it("saves and reloads mid-repair and resumes identically", () => {
    const run = (reload: boolean) => {
      const { simulation, tower, world } = maintainIsland({ planks: 7, stone: 7 });
      runTicks(simulation, 600, [.05]);
      expect(simulation.damageBuilding(tower.uid, DAMAGE)).toBe(true);
      runTicks(simulation, 900, [.05]);
      if (reload) {
        const saved = JSON.parse(JSON.stringify(simulation.saveState()));
        expect(repairers(simulation)).toHaveLength(1);
        expect(simulation.loadState(saved)).toEqual({ ok: true });
      }
      runTicks(simulation, 3000, [.05]);
      expect(wallsOf(simulation, tower.uid)?.hp).toBe(MAXIMUM);
      return hashOf(simulation, world);
    };
    expect(run(true)).toBe(run(false));
  }, TIMEOUT);
});
