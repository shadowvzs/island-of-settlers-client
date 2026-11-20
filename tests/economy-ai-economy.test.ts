import { describe, expect, it } from "vitest";

import {
  KEEP_PRODUCTION, MAX_EXAMINED_BUILDINGS, PAUSE_PRODUCTION, RUN_PRODUCTION
} from "../src/shared/settlement/economy-ai/constants";
import { createDevelopState } from "../src/shared/settlement/economy-ai/develop-state";
import { productionChoice, runEconomyDecision } from "../src/shared/settlement/economy-ai/economy-manager";
import {
  economyStockOf, economyWareIndex, readEconomyStock
} from "../src/shared/settlement/economy-ai/economy-stock";
import { isCellDiscovered } from "../src/shared/settlement/faction-discovery";
import { setVisionProbe, visionProbeReport } from "../src/shared/settlement/faction-vision-probe";
import { getProductionRule } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { unpackBitSet } from "../src/shared/settlement/save-cell-codecs";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { ORE } from "../src/shared/world/world-data";
import { economyCampaignScenario, economyScenario } from "./helpers/economy-factions";
import { huntingWorld } from "./helpers/hunting-world";

const AI = 2;
const WOODCUTTER = 17;
const SAWMILL = 33;
const stock = economyStockOf("balanced");
const LOGS = economyWareIndex("logs");
const PLANKS = economyWareIndex("planks");
const LOGS_TARGET = stock.targets[0]![LOGS]!;

/** Sets the faction's pooled and promised stock of the economy manager's scratch directly. */
const stockOf = (pooled: Readonly<Record<string, number>>, promised: Readonly<Record<string, number>> = {}) => {
  stock.pooled.fill(0);
  stock.promised.fill(0);
  for (const [ware, count] of Object.entries(pooled)) stock.pooled[economyWareIndex(ware)] = count;
  for (const [ware, count] of Object.entries(promised)) stock.promised[economyWareIndex(ware)] = count;
  return stock;
};

const woodcutterRule = getProductionRule(WOODCUTTER)!;
const sawmillRule = getProductionRule(SAWMILL)!;

describe("economy manager: stock targets (plan §3.6)", () => {
  it("pauses a producer at its target, resumes it below the margin and keeps it in between", () => {
    expect(productionChoice(stockOf({ logs: LOGS_TARGET }), woodcutterRule, false)).toBe(PAUSE_PRODUCTION);
    expect(productionChoice(stockOf({ logs: LOGS_TARGET - 1 }), woodcutterRule, false)).toBe(KEEP_PRODUCTION);
    expect(productionChoice(stockOf({ logs: LOGS_TARGET - stock.resumeMargin }), woodcutterRule, false))
      .toBe(RUN_PRODUCTION);
  });

  it("follows the posture's targets (fortify wants fewer planks than grow in the balanced program)", () => {
    const fortifyPlanks = stock.targets[1]![PLANKS]!;
    expect(fortifyPlanks).toBeLessThan(stock.targets[0]![PLANKS]!);
    expect(productionChoice(stockOf({ logs: 0, planks: fortifyPlanks }), sawmillRule, true)).toBe(PAUSE_PRODUCTION);
    expect(productionChoice(stockOf({ logs: 0, planks: fortifyPlanks }), sawmillRule, false)).not
      .toBe(PAUSE_PRODUCTION);
  });

  it("counts what the sites still wait for against the target (free stock)", () => {
    expect(productionChoice(stockOf({ logs: LOGS_TARGET + 4 }, { logs: 4 }), woodcutterRule, false))
      .toBe(PAUSE_PRODUCTION);
    expect(productionChoice(stockOf({ logs: LOGS_TARGET + 4 }, { logs: 3 + stock.resumeMargin + 4 }),
      woodcutterRule, false)).toBe(RUN_PRODUCTION);
  });
});

describe("economy manager: construction inputs first (plan §3.6)", () => {
  it("runs a producer of a ware the build queue starves for, whatever its target", () => {
    expect(productionChoice(stockOf({ logs: 0, planks: 500 }, { planks: 501 }), sawmillRule, false))
      .toBe(RUN_PRODUCTION);
  });

  it("pauses a consumer of a starved construction ware so carriers bring it to the sites", () => {
    expect(productionChoice(stockOf({ logs: 2 }, { logs: 5 }), sawmillRule, false)).toBe(PAUSE_PRODUCTION);
  });
});

const building = (uid: number, typeId: number, extra: Partial<SettlementBuilding> = {}) => ({
  construction: 1, incoming: {}, input: {}, inventory: {}, militaryFaction: AI, required: {}, typeId, uid, ...extra
}) as unknown as SettlementBuilding;

/** A bare context: the faction's producers, one site and its pool. */
const bareContext = (buildings: SettlementBuilding[], available: Record<string, number>) => ({
  actors: [], buildings, options: { world: { scenario: economyScenario([AI]), seed: 1 } }, playerNation: "roman",
  storagePools: { nextId: 2, pools: [{ anchor: 0, available, id: 1, owner: AI }], version: 1 }
}) as unknown as SettlementContext;

describe("economy manager decision", () => {
  it("steers through productionPaused only and never writes stock", () => {
    const woodcutter = building(1, WOODCUTTER);
    const site = building(2, WOODCUTTER, { construction: .2, required: { planks: 4 } });
    const playerWoodcutter = building(3, WOODCUTTER, { militaryFaction: undefined });
    const available = { logs: LOGS_TARGET + 10, planks: 9 };
    const context = bareContext([woodcutter, site, playerWoodcutter], available);
    const before = JSON.stringify({ available, buildings: context.buildings });
    runEconomyDecision(context, AI, createDevelopState(), stock);
    expect(woodcutter.productionPaused).toBe(true);
    expect(playerWoodcutter.productionPaused).toBeUndefined();
    delete woodcutter.productionPaused;
    delete (woodcutter as Partial<SettlementBuilding>).status;
    delete (woodcutter as Partial<SettlementBuilding>).working;
    expect(JSON.stringify({ available, buildings: context.buildings })).toBe(before);
    readEconomyStock(context, AI, stock);
    expect(stock.promised[PLANKS]).toBe(4);
  });

  it("examines at most its quota of own producers per decision from the rolling cursor", () => {
    const producers = Array.from({ length: MAX_EXAMINED_BUILDINGS + 4 }, (_, at) => building(at + 1, WOODCUTTER));
    const context = bareContext(producers, { logs: LOGS_TARGET + 10 });
    const develop = createDevelopState();
    runEconomyDecision(context, AI, develop, stock);
    expect(producers.filter(entry => entry.productionPaused).length).toBe(MAX_EXAMINED_BUILDINGS);
    expect(develop.cursor).toBe(MAX_EXAMINED_BUILDINGS + 1);
    runEconomyDecision(context, AI, develop, stock);
    expect(producers.every(entry => entry.productionPaused)).toBe(true);
    expect(develop.cursor).toBe(0);
  });
});

const DEPOT = { typeId: 0, x: 47, z: 46 };
const START_KIT = { settlers: 6, stock: { axe: 2, hammer: 3, logs: 12, planks: 40, pickaxe: 1, saw: 1, stone: 30 } };
const NEAR_ZONE = { cell: [40, 52], id: 1 };
const FAR_ZONE = { cell: [4, 4], id: 2 };

/** A develop (or maintain) colony with an AI depot and two one-cell deposits: one near it, one far away. */
const island = (mode: "develop" | "maintain" = "develop") => {
  const world = huntingWorld();
  world.mineZone.fill(0);
  world.oreAmount.fill(0);
  world.mineZones = [NEAR_ZONE, FAR_ZONE].map(({ cell: [x, z], id }) => {
    world.mineZone[z! * world.cellsX + x!] = id;
    world.oreAmount[z! * world.cellsX + x!] = 7;
    return { cellCount: 1, centreX: x! + .5, centreZ: z! + .5, id, ore: ORE.iron, richness: 1, surveyed: false };
  });
  world.scenario = economyCampaignScenario([AI], mode, "colony");
  const simulation = createSettlementSimulation({
    canWorkerEnterPlot: () => true, homeBuilding: 0, initialSettlers: 8, roads: createRoadNetwork(world), world
  });
  expect(simulation.aiPlace(AI, DEPOT, START_KIT).ok).toBe(true);
  return { simulation, world };
};

type Island = ReturnType<typeof island>;

const run = ({ simulation }: Island, frames: readonly number[], ticks: number) => {
  for (let frame = 0; simulation.gameTick() < ticks; frame++)
    simulation.update(Math.min(frames[frame % frames.length]!, (ticks - simulation.gameTick()) * .05));
};
const stateHash = ({ simulation }: Island) => hashText(canonicalJson({ ...simulation.saveState(), accumulator: 0 }));
const cellOf = ({ world }: Island, [x, z]: readonly number[]) => z! * world.cellsX + x!;

describe("discovery and the AI geologist (plan §3.2)", () => {
  it("discovers what the faction sees, surveys a seen deposit for itself only, never the far one", () => {
    const game = island();
    run(game, [.05], 3000);
    const saved = game.simulation.saveState().factionAi![0]!.develop!;
    expect(saved.deposits).toEqual([NEAR_ZONE.id]);
    expect(game.world.mineZones.every(zone => !zone.surveyed)).toBe(true);
    expect(saved.discovered?.length).toBe(64 * 64);
    const bits = unpackBitSet(saved.discovered, saved.discovered!.length);
    expect(isCellDiscovered(bits, cellOf(game, [47, 46]))).toBe(true);
    expect(isCellDiscovered(bits, cellOf(game, NEAR_ZONE.cell))).toBe(true);
    expect(isCellDiscovered(bits, cellOf(game, FAR_ZONE.cell))).toBe(false);
  });

  it("keeps a maintain faction's save free of discovery and survey", () => {
    const game = island("maintain");
    run(game, [.05], 1000);
    expect(game.simulation.saveState().factionAi![0]!.develop).toBeUndefined();
  });

  it("decides the same at any frame rate", () => {
    const reference = island();
    run(reference, [.05], 2400);
    for (const frames of [[1 / 60], [.016, .05, .033, .1]]) {
      const other = island();
      run(other, frames, 2400);
      expect(stateHash(other)).toBe(stateHash(reference));
    }
  });

  it("continues identically after a save and reload with the geologist out", () => {
    const reference = island();
    run(reference, [.05], 2400);
    const first = island();
    run(first, [.05], 260);
    const saved = JSON.parse(JSON.stringify(first.simulation.saveState()));
    expect(saved.surveys.length).toBe(1);
    const reloaded = island();
    expect(reloaded.simulation.loadState(saved)).toEqual({ ok: true });
    expect(reloaded.simulation.saveState().factionAi).toEqual(saved.factionAi);
    run(reloaded, [.05], 2400);
    expect(stateHash(reloaded)).toBe(stateHash(reference));
  });

  it("adds no unseen read to the A13 probe", () => {
    setVisionProbe("latest");
    run(island(), [.05], 1200);
    expect(visionProbeReport().reduce((sum, site) => sum + site.unseen, 0)).toBe(0);
  });
});
