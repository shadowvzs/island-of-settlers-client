import { describe, expect, it } from "vitest";

import { COLONY_FORT_RANKS } from "../src/shared/balance/colonies";
import {
  COLONY_SCALED_RANK_CAP, DEVELOP_LEVEL_SCALING, DIFFICULTY_TOWER_ARCHERS, ENEMY_DIFFICULTY_SCALING
} from "../src/shared/balance/enemy-scaling";
import { adventureDefencePlan } from "../src/shared/settlement/adventure-camp-defences";
import {
  colonyFortPlans, colonyOverflowDefenders, EXPEDITION_ISLAND_SIZE
} from "../src/shared/settlement/colony-island-rules";
import { DIFFICULTY_LEVELS, difficultyArcherTowers, difficultyRank } from "../src/shared/settlement/difficulty";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { FACTION_AI_CAPS } from "../src/shared/world/constants";
import { startTroopTotal } from "../src/shared/world/scenario-start-troops";
import {
  advanceSeconds, createBalanceSimulation, withBalanceDifficulty
} from "../tools/bench/garrison-balance-harness";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";

const AI = 2;
const DEPOT = { typeId: 0, x: 47, z: 46 };
const KIT = { settlers: 4, stock: { axe: 1, hammer: 2, logs: 12, planks: 12, stone: 12 } };

/** A develop faction (2) on flat land; `limit` sets the map's soldier limit. */
const developIsland = (limit?: number) => {
  const world = huntingWorld();
  const scenario = economyCampaignScenario([AI], "develop");
  if (limit !== undefined) scenario.factionAi![0]!.limits = { soldiers: limit };
  world.scenario = scenario;
  return createSettlementSimulation({
    canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8, roads: createRoadNetwork(world), world
  });
};

const factionSoldiers = (simulation: ReturnType<typeof developIsland>) =>
  simulation.militarySoldiers().filter(soldier => soldier.combat?.faction === AI);

describe("enemy scaling table (EAI-FINAL)", () => {
  it("keeps Normal a no-op and scales tier and towers up with the global difficulty", () => {
    expect(ENEMY_DIFFICULTY_SCALING.normal).toEqual({ archerTowers: 0, rankBonus: 0 });
    let towers = -1, bonus = -1;
    for (const level of DIFFICULTY_LEVELS) {
      expect(ENEMY_DIFFICULTY_SCALING[level].archerTowers).toBeGreaterThan(towers);
      expect(ENEMY_DIFFICULTY_SCALING[level].rankBonus).toBeGreaterThanOrEqual(Math.max(0, bonus));
      ({ archerTowers: towers, rankBonus: bonus } = ENEMY_DIFFICULTY_SCALING[level]);
    }
    expect(difficultyRank(1)).toBe(1);
    expect(difficultyRank(0, "hard")).toBe(1);
    expect(difficultyRank(2, "veryHard")).toBe(2);
    expect(difficultyArcherTowers()).toBe(0);
  });

  it("raises colony fort ranks and adds adventure archer towers only above Normal", () => {
    const ranks = (level?: "hard" | "veryHard") => colonyFortPlans("medium", 4, level).flatMap(plan => plan.ranks);
    expect(Math.min(...ranks("hard"))).toBe(COLONY_FORT_RANKS.medium[0]! + 1);
    expect(Math.min(...ranks("veryHard"))).toBe(COLONY_FORT_RANKS.medium[0]! + 1);
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const island = { difficulty, seed: 7 };
      const base = adventureDefencePlan(island);
      expect(adventureDefencePlan(island, "normal")).toEqual(base);
      expect(adventureDefencePlan(island, "hard")).toHaveLength(base.length + 1);
      expect(adventureDefencePlan(island, "veryHard")).toHaveLength(base.length + 2);
    }
  });

  it("caps the scaled colony tier by island level: an easy island stays below veteran (EAI-CLOSE)", () => {
    const ranks = (island: "easy" | "medium" | "hard", level?: "hard" | "veryHard") =>
      colonyFortPlans(island, 4, level).flatMap(plan => plan.ranks);
    expect(Math.max(...ranks("easy", "veryHard"))).toBe(COLONY_SCALED_RANK_CAP.easy);
    expect(new Set(ranks("easy", "veryHard"))).toEqual(new Set(ranks("easy")));
    expect(Math.max(...ranks("medium", "veryHard"))).toBe(COLONY_SCALED_RANK_CAP.medium);
    for (const island of ["easy", "medium", "hard"] as const)
      expect(Math.min(...ranks(island))).toBeLessThanOrEqual(COLONY_SCALED_RANK_CAP[island]);
  });

  it("orders the develop rows by level: more start soldiers, never above the full cap", () => {
    const totals = (["easy", "medium", "hard", "veryHard"] as const)
      .map(level => startTroopTotal(DEVELOP_LEVEL_SCALING[level].startSoldiers));
    expect(totals).toEqual([...totals].sort((first, second) => first - second));
    expect(totals[0]).toBeGreaterThan(0);
    for (const row of Object.values(DEVELOP_LEVEL_SCALING))
      expect(row.soldierCap).toBeLessThanOrEqual(FACTION_AI_CAPS.soldiers);
    expect(DEVELOP_LEVEL_SCALING.medium.soldierCap).toBe(FACTION_AI_CAPS.soldiers);
  });
});

describe("develop start soldiers (EAI-FINAL)", () => {
  it("stores the level's start soldiers in a start kit that names none", () => {
    const simulation = developIsland();
    expect(simulation.aiPlace(AI, DEPOT, KIT).ok).toBe(true);
    expect(factionSoldiers(simulation)).toHaveLength(startTroopTotal(DEVELOP_LEVEL_SCALING.medium.startSoldiers));
  });

  it("keeps an explicit soldier list and the map's soldier limit", () => {
    const explicit = developIsland();
    expect(explicit.aiPlace(AI, DEPOT, { ...KIT, soldiers: [] }).ok).toBe(true);
    expect(factionSoldiers(explicit)).toHaveLength(0);
    const limited = developIsland(1);
    expect(limited.aiPlace(AI, DEPOT, KIT).ok).toBe(true);
    expect(factionSoldiers(limited)).toHaveLength(1);
  });
});

const COLONY = { difficulty: "medium" as const, id: 0, name: "Scaling", ore: "stone" as const, seed: 3,
  voyageSeconds: 120 };
const SEED = 3;

/** A medium colony under the global Hard difficulty on the flat balance island. */
const hardColony = () => withBalanceDifficulty("hard", () => {
  const simulation = createBalanceSimulation(EXPEDITION_ISLAND_SIZE, SEED);
  expect(simulation.startColony({ island: COLONY, landed: {}, troops: [] }).ok).toBe(true);
  return simulation;
});

describe("colony difficulty towers (EAI-FINAL)", () => {
  it("raises the Hard tower beside the forts, and plays the same after a save and reload", () => {
    const simulation = hardColony();
    const forts = colonyFortPlans("medium", SEED, "hard");
    const hostile = simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
    const towers = ENEMY_DIFFICULTY_SCALING.hard.archerTowers +
      Math.ceil(colonyOverflowDefenders("medium", SEED, "hard") / DIFFICULTY_TOWER_ARCHERS);
    expect(hostile).toHaveLength(forts.length + towers);
    const enemies = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) > 0);
    expect(enemies).toHaveLength(forts.reduce((sum, fort) => sum + fort.troops.length, 0) +
      towers * DIFFICULTY_TOWER_ARCHERS);
    advanceSeconds(simulation, 5);
    const saved = simulation.saveState();
    const reloaded = withBalanceDifficulty("hard", () => createBalanceSimulation(EXPEDITION_ISLAND_SIZE, SEED));
    const loaded = reloaded.loadState(structuredClone(saved));
    expect(loaded, JSON.stringify(loaded)).toEqual({ ok: true });
    advanceSeconds(simulation, 20);
    advanceSeconds(reloaded, 20);
    expect(reloaded.saveState()).toEqual(simulation.saveState());
  });
});
