import { describe, expect, it } from "vitest";

import { COLONY_COUNTERATTACKS, COLONY_DIFFICULTIES } from "../src/shared/balance/colonies";
import { DIFFICULTY_PROFILES, type DifficultyProfile } from "../src/shared/balance/enemy-scaling";
import { adventureEnemyPlan } from "../src/shared/settlement/adventure-rules";
import { colonyFortPlans, colonyOverflowDefenders } from "../src/shared/settlement/colony-island-rules";
import {
  DIFFICULTY_LEVELS, type DifficultyLevel, difficultyProfile, difficultyScaled, isDifficultyLevel
} from "../src/shared/settlement/difficulty";
import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  scaledLandRaidSize, scaledRaidShipTroops
} from "../src/shared/settlement/settlement-colony-counterattack";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const PROFILE_FIELDS = Object.keys(DIFFICULTY_PROFILES.normal) as (keyof DifficultyProfile)[];

const flatWorld = () => {
  const size = 40;
  return { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
};

/** Two authored field soldiers and a two-soldier garrison: the scenario starting-soldier hook. */
const scenarioWorld = (): WorldData => {
  const world = flatWorld();
  world.scenario = { ...createMapScenario(), kind: "colony",
    headquarters: { x: 8, z: 8, rotation: 0 }, landing: { x: 14, z: 14 }, stock: {}, settlers: 0,
    units: [
      { id: 1, x: 25, z: 25, type: "shield", rank: 0, heading: 0, faction: 2, group: 0 },
      { id: 2, x: 20, z: 25, type: "archer", rank: 0, heading: 0, faction: 2, group: 0 }
    ],
    buildings: [{ id: 3, x: 29.5, z: 12, rotation: 0, type: 2, faction: 2, defenders: 2 }] };
  return world;
};

const scenarioSimulation = (difficulty?: DifficultyLevel) => {
  const world = scenarioWorld();
  return createSettlementSimulation({
    difficulty, roads: createRoadNetwork(world), world
  });
};

/** One authored hostile catapult with three stones: the scenario starting-stock hook. */
const catapultWorld = (): WorldData => {
  const world = flatWorld();
  world.scenario = { ...createMapScenario(), kind: "colony",
    headquarters: { x: 8, z: 8, rotation: 0 }, landing: { x: 14, z: 14 }, stock: {}, settlers: 0,
    buildings: [{ id: 1, x: 28.5, z: 12.5, rotation: 0, type: 16, faction: 2, defenders: 2,
      catapult: { variant: "bandit", stones: 3 } }] };
  return world;
};

const catapultStones = (difficulty?: DifficultyLevel) => {
  const world = catapultWorld();
  const simulation = createSettlementSimulation({
    difficulty, roads: createRoadNetwork(world), world
  });
  return catapultLocalStone(simulation.buildings().find(building => building.typeId === 16)!);
};

describe("difficulty profiles", () => {
  it("names the three frozen levels with Normal at exactly one everywhere", () => {
    expect(DIFFICULTY_LEVELS).toEqual(["normal", "hard", "veryHard"]);
    expect(Object.isFrozen(DIFFICULTY_PROFILES)).toBe(true);
    for (const level of DIFFICULTY_LEVELS) {
      expect(Object.isFrozen(DIFFICULTY_PROFILES[level])).toBe(true);
      expect(difficultyProfile(level)).toBe(DIFFICULTY_PROFILES[level]);
      expect(isDifficultyLevel(level)).toBe(true);
    }
    expect(DIFFICULTY_PROFILES.normal).toEqual({
      productionSpeed: 1, raidSize: 1, soldiers: 1, startingStock: 1, trainingSpeed: 1
    });
    expect(DIFFICULTY_PROFILES.hard).toEqual({
      productionSpeed: 1.25, raidSize: 1.3, soldiers: 1.4, startingStock: 1.4, trainingSpeed: 1.25
    });
    expect(DIFFICULTY_PROFILES.veryHard).toEqual({
      productionSpeed: 1.5, raidSize: 1.6, soldiers: 1.8, startingStock: 1.8, trainingSpeed: 1.5
    });
  });

  it("falls back to Normal for an unknown value and keeps Normal an unrounded no-op", () => {
    expect(difficultyProfile("legendary" as DifficultyLevel)).toBe(DIFFICULTY_PROFILES.normal);
    expect(isDifficultyLevel("legendary")).toBe(false);
    expect(isDifficultyLevel(undefined)).toBe(false);
    for (const field of PROFILE_FIELDS) expect(difficultyScaled(7.3, field, "normal")).toBe(7.3);
  });
});

describe("enemy-side hooks", () => {
  it("scales every adventure camp's soldiers and keeps its authored type rotation", () => {
    expect(adventureEnemyPlan("hard").camps.map(camp => camp.troops.length))
      .toEqual([6, 10, 9, 9, 9, 8]);
    const hard = adventureEnemyPlan("hard", "hard");
    expect(hard.camps.map(camp => camp.troops.length)).toEqual([8, 14, 13, 13, 13, 11]);
    expect(hard.camps.flatMap(camp => camp.troops).slice(0, 4))
      .toEqual(adventureEnemyPlan("hard").camps.flatMap(camp => camp.troops).slice(0, 4));
    expect(adventureEnemyPlan("hard", "veryHard").camps.map(camp => camp.troops.length))
      .toEqual([11, 18, 16, 16, 16, 14]);
    // Hard plays one tier up (enemy scaling table): the hard island's ranks 1/2 become veterans.
    for (const camp of hard.camps) expect(new Set(camp.ranks)).toEqual(new Set([2]));
    for (const camp of adventureEnemyPlan("medium", "hard").camps)
      expect(Math.min(...camp.ranks)).toBeGreaterThanOrEqual(1);
  });

  it("scales colony fort defender totals without changing the canonical plan", () => {
    const total = (level?: DifficultyLevel) => colonyFortPlans("medium", 4, level)
      .reduce((sum, fort) => sum + fort.troops.length, 0);
    expect(total()).toBe(COLONY_DIFFICULTIES.medium.enemyTroops);
    // Above the camps' capacity the extra defenders man the difficulty's archer towers (EAI-FINAL).
    expect(total("hard") + colonyOverflowDefenders("medium", 4, "hard"))
      .toBe(Math.round(COLONY_DIFFICULTIES.medium.enemyTroops * 1.4));
    expect(total("veryHard") + colonyOverflowDefenders("medium", 4, "veryHard"))
      .toBe(Math.round(COLONY_DIFFICULTIES.medium.enemyTroops * 1.8));
    expect(colonyOverflowDefenders("medium", 4)).toBe(0);
    expect(colonyFortPlans("medium", 4, "normal")).toEqual(colonyFortPlans("medium", 4));
  });

  it("scales the counterattack land party and raid-ship troop list", () => {
    const rule = COLONY_COUNTERATTACKS.hard!;
    const ship = rule.ship!;
    expect(scaledLandRaidSize(rule)).toBe(rule.landSize);
    expect(scaledLandRaidSize(rule, "hard")).toBe(Math.round(rule.landSize * 1.3));
    expect(scaledLandRaidSize(rule, "veryHard")).toBe(Math.round(rule.landSize * 1.6));
    expect(scaledRaidShipTroops(ship)).toEqual(ship.troops.map((type, index) =>
      ({ rank: ship.ranks[index % ship.ranks.length]!, type })));
    const hard = scaledRaidShipTroops(ship, "hard");
    expect(hard).toHaveLength(Math.round(ship.troops.length * 1.3));
    expect(hard.map(troop => troop.type)).toEqual([...ship.troops, ship.troops[0]!, ship.troops[1]!]);
    expect(scaledRaidShipTroops(ship, "veryHard"))
      .toHaveLength(Math.round(ship.troops.length * 1.6));
  });

  it("scales authored hostile catapult stone as the computer side's starting stock", () => {
    expect(catapultStones()).toBe(3);
    expect(catapultStones("hard")).toBe(Math.round(3 * 1.4));
    expect(catapultStones("veryHard")).toBe(Math.round(3 * 1.8));
  });

  it("scales authored scenario soldiers, capping a garrison at its camp capacity", () => {
    expect(scenarioSimulation().militarySoldiers()).toHaveLength(2 + 2);
    expect(scenarioSimulation("normal").militarySoldiers()).toHaveLength(4);
    expect(scenarioSimulation("hard").militarySoldiers()).toHaveLength(3 + 3);
    // The guardhouse holds three: Very hard's four defenders are capped at its capacity.
    expect(scenarioSimulation("veryHard").militarySoldiers()).toHaveLength(4 + 3);
  });
});

describe("difficulty save state", () => {
  it("saves only a non-Normal level and restores it round-trip", () => {
    const normal = scenarioSimulation();
    expect(normal.saveState()).not.toHaveProperty("difficulty");
    expect(Object.keys(normal.saveState())).not.toContain("difficulty");
    const hard = scenarioSimulation("hard"), saved = hard.saveState();
    expect(saved.difficulty).toBe("hard");
    expect(hard.loadState(saved)).toEqual({ ok: true });
    expect(hard.saveState().difficulty).toBe("hard");
    expect(normal.loadState(saved)).toEqual({ ok: true });
    expect(normal.saveState().difficulty).toBe("hard");
  });

  it("loads a save without the field as Normal and rejects an unknown level", () => {
    const simulation = scenarioSimulation("hard"), hard = simulation.saveState();
    const plain = { ...hard };
    delete plain.difficulty;
    expect(simulation.loadState(plain)).toEqual({ ok: true });
    expect(simulation.saveState()).not.toHaveProperty("difficulty");
    const invalid = { ...plain, difficulty: "legendary" };
    expect(simulation.loadState(invalid))
      .toEqual({ ok: false, reason: "Invalid difficulty" });
  });
});
