import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { createGameSave } from "../src/shared/settlement/game-save";
import { EXPEDITION_SUPPLIES } from "../src/shared/settlement/settlement-naval-preparation";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import { isSharedStorageWare } from "../src/shared/settlement/shared-storage";
import { DEFAULT_WORLD_OPTIONS } from "../src/shared/world/generation/generate-world";
import { cachedWorld } from "./helpers/cached-worlds";
import { navalPassengerFixture as fixture } from "./helpers/naval-passenger-fixture";

const START = 1_000_000;

/**
 * Planks anywhere on the island: storage pools, buildings, carried loads and ship cargo. While porters
 * load a ship its cargo is only the intended load; the planks still lie reserved in the harbour
 * (`shipReserve`) until the last box is aboard, so that cargo counts only once the transfer settled.
 */
const planks = (state: SettlementSaveV1) =>
  state.storagePools.pools.reduce((sum, pool) => sum + (pool.available.planks ?? 0), 0) +
  state.buildings.reduce((sum, building) => sum + (building.inventory.planks ?? 0) +
    (building.input.planks ?? 0) + (building.output.planks ?? 0) + (building.shipReserve?.planks ?? 0) +
    (building.constructionConsumed?.planks ?? 0), 0) +
  state.actors.reduce((sum, actor) => sum + (actor.ware === "planks" ? actor.wareUnits ?? 1 : 0), 0) +
  state.naval.fleet.ships.reduce((sum, ship) => sum + (ship.transfer ? 0 : ship.cargo?.planks ?? 0), 0);

/** A save taken while the expedition crew walks over the pier and porters carry the cargo aboard. */
const boardingSave = async () => {
  const base = cachedWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: 150, cellsZ: 60, erosionDroplets: 0 });
  const { simulation, source, world } = fixture(base);
  for (const ware of Object.keys(source.inventory)) if (isSharedStorageWare(ware)) delete source.inventory[ware];
  Object.assign(source.inventory, { ...EXPEDITION_SUPPLIES });
  expect(simulation.queueSeaExpedition(source.uid, { x: 110, z: 30, rotation: 0 })).not.toBeNull();
  const boarding = () => simulation.frames().some(actor => actor.phase === "navalBoarding");
  for (let tick = 0; tick < 6000 && !boarding(); tick++) simulation.update(.05);
  expect(boarding()).toBe(true);
  return createGameSave(world, simulation.saveState(), {
    name: "Boarding expedition", source: "generated", savedAt: START, animals: [] });
};

describe("offline catch-up of a boarding expedition", () => {
  it("finishes boarding and sails in the exact replay without losing or doubling cargo", async () => {
    const save = await boardingSave();
    const before = planks(save.settlement);
    const after = await advanceOfflineGame(structuredClone(save), START + 120_000, () => {}, { exact: true });
    expect(planks(after.settlement)).toBe(before);
    expect(after.settlement.naval.fleet.ships[0]!.phase).not.toMatch(/^(positioning|loading)$/);
    expect(after.settlement.actors.filter(actor => ["navalWaiting", "navalToShip", "navalBoarding"]
      .includes(actor.phase))).toEqual([]);
    await expect(stageGameSession(after)).resolves.toBeDefined();
  }, 120_000);

  it("keeps the boarding expedition intact through the default fast offline economy", async () => {
    // The fast economy (owner 2026-11-04 default) does not move ships; the loading resumes live.
    const save = await boardingSave();
    const before = planks(save.settlement);
    const after = await advanceOfflineGame(structuredClone(save), START + 120_000);
    expect(planks(after.settlement)).toBe(before);
    expect(after.settlement.naval.fleet.ships[0]!.phase).toBe(save.settlement.naval.fleet.ships[0]!.phase);
    const crew = (state: SettlementSaveV1) => state.actors.filter(actor => actor.navalOrder !== undefined)
      .map(actor => actor.uid);
    expect(crew(after.settlement)).toEqual(crew(save.settlement));
    await expect(stageGameSession(after)).resolves.toBeDefined();
  }, 120_000);
});
