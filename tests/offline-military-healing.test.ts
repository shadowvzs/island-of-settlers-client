import { expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const SAVED_AT = 5_000_000;

/** Two wounded reserves resting in the headquarters, missing 100 and 6.25 HP. */
const healingSave = async (): Promise<GameSaveV1> => {
  const world = huntingWorld();
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, initialSettlers: 20,
    initialStock: { planks: 48, stone: 48 }, canWorkerEnterPlot: () => true });
  simulation.receiveTroops([{ hp: 25, rank: 0, type: "shield" }, { hp: 50, rank: 0, type: "archer" }]);
  return createGameSave(world, simulation.saveState(), {
    name: "Military healing offline fixture", savedAt: SAVED_AT, source: "generated", animals: []
  });
};

const soldiers = (save: GameSaveV1) => save.settlement.military!.soldiers;
const hpOf = (save: GameSaveV1, type: "archer" | "shield") =>
  soldiers(save).find(soldier => soldier.combat?.type === type)!.combat!.hp;
const timerOf = (save: GameSaveV1, type: "archer" | "shield") =>
  soldiers(save).find(soldier => soldier.combat?.type === type)!.recoverySeconds ?? 0;

it("fast catch-up heals whole resting minutes, then native ticks continue from the remainder", async () => {
  const source = await healingSave();
  const before = structuredClone(source.settlement);
  const after = await advanceOfflineGame(source, source.savedAt + 3_600_000, () => {},
    { economy: true, economyCalibrationSeconds: 0 });
  expect(hpOf(after, "shield")).toBe(85);
  expect(hpOf(after, "archer")).toBe(56.25);
  expect(timerOf(after, "shield")).toBe(0);
  expect(timerOf(after, "archer")).toBe(0);
  expect(after.settlement.buildings[0]!.inventory).toEqual(before.buildings[0]!.inventory);
  expect(soldiers(after)).toHaveLength(soldiers(source).length);
  await expect(stageGameSession(after)).resolves.toBeDefined();
  const continued = await advanceOfflineGame(after, after.savedAt + 60_000, () => {},
    { exact: true, eventCore: false });
  expect(hpOf(continued, "shield")).toBe(86);
  expect(timerOf(continued, "shield")).toBe(0);
});

it("short native and calibrated fast catch-up agree on the same eligible minutes", async () => {
  const exactSource = await healingSave();
  const fastSource = await healingSave();
  const exact = await advanceOfflineGame(exactSource, exactSource.savedAt + 300_000, () => {},
    { exact: true, eventCore: false });
  const fast = await advanceOfflineGame(fastSource, fastSource.savedAt + 300_000, () => {},
    { economy: true, economyCalibrationSeconds: 120 });
  expect(hpOf(exact, "shield")).toBe(30);
  expect(hpOf(fast, "shield")).toBe(30);
  expect(timerOf(exact, "shield")).toBe(0);
  expect(timerOf(fast, "shield")).toBe(0);
  expect(hpOf(fast, "archer")).toBe(55);
  expect(timerOf(fast, "archer")).toBe(0);
  await expect(stageGameSession(fast)).resolves.toBeDefined();
}, 20_000);
