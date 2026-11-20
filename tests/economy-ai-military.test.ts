import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { resolvedBuildProgram } from "../src/shared/settlement/economy-ai/build-program";
import { NO_EXPANSION_TARGET } from "../src/shared/settlement/economy-ai/constants";
import { raiseExpansion } from "../src/shared/settlement/economy-ai/develop-expansion";
import { garrisonTargetOf, garrisonTowers } from "../src/shared/settlement/economy-ai/develop-garrison";
import { fillWantedCounts } from "../src/shared/settlement/economy-ai/develop-goals";
import { createDevelopState } from "../src/shared/settlement/economy-ai/develop-state";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";
import { economyCampaignScenario } from "./helpers/economy-factions";
import { huntingWorld, plantForestEdge } from "./helpers/hunting-world";

/** EAI4a: the economy AI funds, equips and garrisons its own soldiers and grows its land with garrisons. */
const AI = 2;
const ARMORY = 24;
const ACADEMY = 40;
const GUARDHOUSE = 2;
const DEPOT = { typeId: 0, x: 47, z: 46 };
const NONE = NO_EXPANSION_TARGET;
const RECRUIT_WARES = { armor: 3, beer: 3, shield: 3, sword: 3 };
const BUILD_WARES = { axe: 2, hammer: 3, logs: 12, planks: 40, pickaxe: 1, saw: 1, shovel: 1, stone: 30 };

const plotAt = (typeId: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(typeId).gridFootprint;
  return { typeId, x: x + width / 2, z: z + depth / 2 };
};

interface IslandSetup {
  settlers?: number;
  soldiers?: number;
  stock?: Record<string, number>;
}

type IslandWorld = ReturnType<typeof huntingWorld>;
/** The world each island plays on (construction fells its trees and levels its ground, as a game save keeps it). */
const worlds = new WeakMap<object, IslandWorld>();

/** A simulation of `world` whose roads route round buildings, as on a live island. */
const simulationOn = (world: IslandWorld) => {
  let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8,
    roads, world });
  return simulation;
};

/** The faction's depot with the kit, then finished buildings raised for free (`aiPlace` with an empty kit). */
const island = ({ settlers = 20, soldiers = 0, stock = {} }: IslandSetup, finished: readonly number[][] = []) => {
  const world = huntingWorld();
  plantForestEdge(world);
  world.scenario = economyCampaignScenario([AI], "develop");
  const simulation = simulationOn(world);
  // An explicit soldier list (empty without `soldiers`): no level start soldiers (enemy scaling table).
  const kit = { settlers, soldiers: soldiers ? [{ count: soldiers, rank: 0, type: "shield" as const }] : [],
    stock: { ...BUILD_WARES, ...stock } };
  const depot = simulation.aiPlace(AI, DEPOT, kit);
  expect(depot.ok, depot.reason).toBe(true);
  for (const [typeId, x, z] of finished) {
    const placed = simulation.aiPlace(AI, plotAt(typeId!, x!, z!), {});
    expect(placed.ok, `${typeId}: ${placed.reason}`).toBe(true);
    expect(simulation.connectFactionRoads(AI, depot.building!.access, placed.building!.access)).toBeTruthy();
  }
  worlds.set(simulation, world);
  return simulation;
};

type Simulation = ReturnType<typeof island>;

const run = (simulation: Simulation, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
};

const soldiersOf = (simulation: Simulation) =>
  simulation.saveState().military?.soldiers.filter(soldier => soldier.combat?.faction === AI) ?? [];
const ownOf = (simulation: Simulation, typeId: number) =>
  simulation.buildings().find(building => building.militaryFaction === AI && building.typeId === typeId);
/** What the AI decided for its army: its soldiers' type and post, its Academy queue and its faction AI state. */
const militaryDecisionsOf = (simulation: Simulation) => {
  const { factionAi, tavern } = simulation.saveState();
  const soldiers = soldiersOf(simulation).map(({ actor, building, combat, stationed }) =>
    ({ actor, building, stationed, type: combat?.type }));
  return { factionAi, soldiers, tavern };
};
const stateHash = (simulation: Simulation) => hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));

describe("garrison targets and expansion (pure)", () => {
  it("keeps every place manned while it fortifies, else half (at least one, which claims the land)", () => {
    const tower = (typeId: number) => ({ typeId }) as SettlementBuilding;
    expect(garrisonTargetOf(tower(GUARDHOUSE), false)).toBe(2);
    expect(garrisonTargetOf(tower(GUARDHOUSE), true)).toBe(3);
    expect(garrisonTargetOf(tower(1), false)).toBe(1);
  });

  it("only gives each tower its first soldier while the faction's own attack runs (EAI4b intents)", () => {
    const tower = { construction: 1, militaryFaction: AI, typeId: GUARDHOUSE, uid: 7 } as SettlementBuilding;
    const inside: number[] = [];
    const garrisonFromReserve = (_uid: number, target?: number) => {
      if (inside.length >= (target ?? 3)) return false;
      inside.push(target ?? 3);
      return true;
    };
    const statusOf = (status: string) => ({ strategy: { status: () => [{ index: 0, kind: "attack", status,
      strength: 0 }] } });
    const context = (status: string) => ({ buildings: [tower], military: { garrisonFromReserve },
      militaryDirector: statusOf(status) }) as never;
    expect(garrisonTowers(context("forming"), AI, true)).toBe(1);
    inside.length = 0;
    expect(garrisonTowers(context("done"), AI, true)).toBe(3);
  });

  it("leaves the level's raid party out of the filling pass (easy raids, owner 2026-11-17)", () => {
    const tower = { construction: 1, militaryFaction: AI, typeId: GUARDHOUSE, uid: 7 } as SettlementBuilding;
    let free = 5;
    const inside: number[] = [];
    const garrisonFromReserve = (_uid: number, target?: number) => {
      if (inside.length >= (target ?? 3) || free <= 0) return false;
      inside.push(target ?? 3);
      free--;
      return true;
    };
    const context = { buildings: [tower], military: { garrisonFromReserve, spareReserve: () => free },
      militaryDirector: { strategy: { fieldStrength: () => 0, status: () => [] } } } as never;
    expect(garrisonTowers(context, AI, true, 4), "first soldier, then nothing beyond the party of four").toBe(1);
    expect(free).toBe(4);
    inside.length = 0;
    free = 5;
    expect(garrisonTowers(context, AI, true), "no party kept: filled to its target").toBe(3);
  });

  it("wants one more guardhouse when plots run out or a seen deposit lies beyond its land, with a soldier for it", () => {
    const program = resolvedBuildProgram("balanced", "roman");
    const guardhouse = program.expansion;
    const { counts, finished, wanted } = program.view;
    counts.fill(0);
    finished.fill(0);
    program.view.ownBuildings = 4;
    fillWantedCounts(program);
    const develop = createDevelopState();
    raiseExpansion(program, develop, 3, NONE);
    expect(wanted[guardhouse]).toBe(0);
    develop.backoffs.push({ attempts: 2, goal: "woodcutter", retryTick: 0 });
    raiseExpansion(program, develop, 0, NONE);
    expect(wanted[guardhouse], "no soldier to man it").toBe(0);
    raiseExpansion(program, develop, 1, NONE);
    expect(wanted[guardhouse]).toBe(1);
    develop.backoffs[0]!.goal = "ironMine";
    fillWantedCounts(program);
    raiseExpansion(program, develop, 3, NONE);
    expect(wanted[guardhouse], "a mine waits for a deposit it has seen").toBe(0);
    raiseExpansion(program, develop, 3, 1234);
    expect(wanted[guardhouse], "towards a seen deposit beyond its land").toBe(1);
    fillWantedCounts(program);
  });
});

describe("develop: military economy (EAI4a)", () => {
  it("recruits its own soldiers at its Academy from its own equipment, one order at a time", () => {
    const simulation = island({ stock: RECRUIT_WARES }, [[ACADEMY, 52, 36]]);
    run(simulation, [.05], 3600);
    const soldiers = soldiersOf(simulation);
    expect(soldiers.length).toBeGreaterThanOrEqual(2);
    expect(soldiers.every(soldier => soldier.combat?.type === "shield")).toBe(true);
    expect(simulation.saveState().military?.soldiers.some(soldier => (soldier.combat?.faction ?? 0) === 0 &&
      soldier.combat?.type === "shield" && soldiers.length === 0)).toBe(false);
  });

  it("orders swords and shields at its armory for the soldiers it funds, nothing else", () => {
    const simulation = island({}, [[ARMORY, 52, 36], [GUARDHOUSE, 38, 36]]);
    run(simulation, [.05], 100);
    const armory = ownOf(simulation, ARMORY)!;
    expect(armory.productionOrders?.sword).toBeGreaterThan(0);
    expect(armory.productionOrders?.shield).toBe(armory.productionOrders?.sword);
    expect(armory.productionOrders).toMatchObject({ axe: 0, bow: 0 });
  });

  it("mans its guardhouse to its target from the depot reserve, which claims land", () => {
    const simulation = island({ soldiers: 4 }, [[GUARDHOUSE, 38, 36]]);
    run(simulation, [.05], 1200);
    const guardhouse = ownOf(simulation, GUARDHOUSE)!;
    const inside = soldiersOf(simulation).filter(soldier => soldier.building === guardhouse.uid);
    expect(inside).toHaveLength(garrisonTargetOf(guardhouse, false));
  });

  /*
   * The reload loads into a copy of the island's own world, as a game save carries it (EAI4-FOLLOWUP: the drift once
   * seen here came from reloading into a fresh world whose felled trees and levelled ground stood again).
   */
  it("decides the same at any frame rate and across a save and reload while a recruit trains", () => {
    const setup = { soldiers: 1, stock: RECRUIT_WARES };
    const finished = [[ACADEMY, 52, 36], [GUARDHOUSE, 38, 36]];
    const reference = island(setup, finished);
    run(reference, [.05], 3000);
    const mixed = island(setup, finished);
    run(mixed, [.016, .05, .033, .1], 3000);
    expect(stateHash(mixed)).toBe(stateHash(reference));
    const first = island(setup, finished);
    while (first.saveState().tavern?.batches[0]?.[1].stage !== "train") run(first, [.05], first.gameTick() + 1);
    const saved = JSON.parse(JSON.stringify(first.saveState()));
    const reloaded = simulationOn(structuredClone(worlds.get(first)!));
    expect(reloaded.loadState(saved)).toEqual({ ok: true });
    run(reloaded, [1 / 60], 3000);
    expect(stateHash(reloaded)).toBe(stateHash(reference));
    expect(militaryDecisionsOf(reloaded)).toEqual(militaryDecisionsOf(reference));
    expect(soldiersOf(reference).length).toBeGreaterThanOrEqual(2);
  });
});
