import { expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineEconomyMetrics } from "../src/app/settlement/offline-economy";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const SAVED_AT = 5_000_000;

/** A finished barracks with two stationed swordsmen and a training timer already running. */
const militarySave = async (): Promise<GameSaveV1> => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20, initialStock: {
    beer: 4, planks: 48, shield: 4, stone: 48, sword: 4
  }, canWorkerEnterPlot: () => true });
  const placed = simulation.placeBuilding(1, 20, 20);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  const barracks = placed.building;
  barracks.construction = 1; barracks.required = {};
  expect(roads.addRoad(simulation.headquarters.access, barracks.access)).toBe(true);
  simulation.setMilitaryCoins(barracks.uid, false);
  for (let index = 0; index < 2; index++) simulation.recruitStoredMilitary(simulation.headquarters.uid, "shield");
  for (let tick = 0; tick < 120 * 20; tick++) simulation.update(.05);
  // Only these local supplies may fund promotion; no warehouse delivery can join mid-test.
  barracks.input.coins = 2; barracks.input.wine = 2;
  const live = simulation.buildings().find(building => building.uid === barracks.uid)!;
  expect(live.input).toEqual({ coins: 2, wine: 2 });
  expect(simulation.playerNation()).toBe("roman");
  expect(simulation.militaryBuildings()[0]?.ranks).toEqual([0, 0]);
  for (let tick = 0; tick < 20; tick++) simulation.update(.05);
  expect(simulation.militaryBuildings()[0]?.stationed).toBe(2);
  expect(live.input.coins).toBe(2);
  expect(live.input.wine).toBe(2);
  expect(simulation.saveState().military?.trainTimers).toHaveLength(1);
  return createGameSave(world, simulation.saveState(), {
    name: "Military supply offline fixture", savedAt: SAVED_AT, source: "generated", animals: []
  });
};

const militaryBuilding = (save: GameSaveV1) => save.settlement.buildings.find(building => building.typeId === 1)!;

it("fast offline replay preserves military promotion state and never spends local supplies", async () => {
  const source = await militarySave();
  const before = structuredClone(source.settlement);
  const reports: OfflineEconomyMetrics[] = [];
  const after = await advanceOfflineGame(source, source.savedAt + 3_600_000, () => {},
    { economy: true, economyCalibrationSeconds: 0, onEconomyMetrics: metrics => reports.push(metrics) });
  expect(reports).toHaveLength(1);
  const homeRates = reports[0]!.estimates.find(island => island.islandId === "home")!.rates;
  expect(homeRates.unsupported).toContainEqual({
    uid: militaryBuilding(source).uid, reason: "service consumption omitted"
  });
  expect(after.settlement.military).toEqual(before.military);
  expect(militaryBuilding(after).input).toEqual(militaryBuilding(source).input);
  expect(militaryBuilding(after).incoming).toEqual(militaryBuilding(source).incoming);
  expect(after.settlement.actors.filter(actor => actor.job === "Soldier"))
    .toEqual(before.actors.filter(actor => actor.job === "Soldier"));
  await expect(stageGameSession(after)).resolves.toBeDefined();
}, 20_000);

it("exact offline replay resumes the saved timer and charges one coin and one wine per promotion", async () => {
  const source = await militarySave();
  const after = await advanceOfflineGame(source, source.savedAt + 30_000, () => {},
    { exact: true, eventCore: false });
  expect(after.settlement.military!.soldiers.map(soldier => soldier.rank).sort((a, b) => a - b))
    .toEqual([1, 1]);
  expect(militaryBuilding(after).input.coins).toBe(0);
  expect(militaryBuilding(after).input.wine).toBe(0);
  await expect(stageGameSession(after)).resolves.toBeDefined();
}, 20_000);
