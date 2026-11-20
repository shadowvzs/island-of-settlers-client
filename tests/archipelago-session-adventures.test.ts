import { describe, expect, it, vi } from "vitest";

import { createArchipelagoSession } from "../src/app/settlement/archipelago-session";
import {
  type AdventureIsland, adventureOffers, adventureRewardGoods
} from "../src/shared/settlement/adventure-rules";
import { addAdventureRecord, type Archipelago,emptyArchipelago } from "../src/shared/settlement/archipelago";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { createMemorySaveStore } from "./memory-save-store";

const island = adventureOffers(3).find(entry => entry.difficulty === "medium")!;
const troops: EmigratedTroop[] = [{ hp: 100, rank: 0, type: "shield" }];
const soldier = (faction: number) => ({ actor: faction, building: -1, rank: 1, stationed: false,
  combat: { cooldown: 0, faction, hp: 50, type: "heavy" } });

/** A fake island simulation: its adventure status, soldiers and the calls the session makes. */
const fakeSimulation = (adventure?: { status: string }) => {
  const calls = { aboard: [] as EmigratedTroop[], received: [] as EmigratedTroop[], released: [] as number[],
    roles: [] as unknown[], ships: [] as Goods[] };
  const simulation = {
    adventure: () => adventure, buildings: () => [], colony: () => undefined, colonyExpeditions: () => [],
    gameNow: () => Date.UTC(2026, 9, 22),
    receiveTroops: (list: EmigratedTroop[]) => { calls.received.push(...list); },
    releaseColony: (id: number) => { calls.released.push(id); return true; },
    saveState: () => ({ military: { soldiers: [soldier(0), soldier(1)] } }),
    sendVisitorShip: (cargo: Goods, _pickup: string[], role: unknown, aboard: EmigratedTroop[] = []) => {
      calls.ships.push(cargo); calls.roles.push(role); calls.aboard.push(...aboard); return 1;
    }
  } as unknown as SettlementSimulation;
  return { calls, simulation };
};
type AdventureClaim = (island: AdventureIsland, lootBonus: number) => Promise<Goods | string>;
const session = (simulation: SettlementSimulation, initial: Archipelago, claimAdventure?: AdventureClaim) => {
  const { store, values: stored } = createMemorySaveStore(), messages: string[] = [];
  const travel = createArchipelagoSession({ capture: async () => ({ map: "island", settlement: simulation.saveState() }) as unknown as GameSaveV1,
    claimAdventure, initial, notify: text => messages.push(text), reload: () => undefined, simulation,
    store });
  return { messages, stored, travel };
};

describe("adventure island travel", () => {
  it("discards a won adventure on the way home and carries survivors and the reward", async () => {
    const group: Archipelago = { ...addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops }),
      active: 7, home: { map: "home" } as unknown as GameSaveV1 };
    const { simulation } = fakeSimulation({ status: "won" });
    const { stored, travel } = session(simulation, group);
    expect(travel.adventures()).toMatchObject([{ status: "won" }]);
    expect(await travel.returnHome()).toBe(true);
    const payload = JSON.parse(stored.get("startup")!) as GameSaveV1;
    expect(payload.map).toBe("home");
    expect(payload.archipelago).toMatchObject({ active: null, released: [7], rewards: adventureRewardGoods(island) });
    expect(payload.archipelago!.adventures).toBeUndefined();
    expect(payload.archipelago!.returning).toEqual([{ hp: 50, rank: 1, type: "heavy" }]);
  });

  it("a signed-in player's loot is the server's confirmed credit; offline keeps the adventure filed", async () => {
    const group: Archipelago = { ...addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops }),
      active: 7, home: { map: "home" } as unknown as GameSaveV1 };
    const { simulation } = fakeSimulation({ status: "won" });
    let online = false;
    const claim = vi.fn(async (): Promise<Goods | string> => {
      if (!online) throw new Error("offline");
      return { coins: 5, planks: 1 };
    });
    const { messages, stored, travel } = session(simulation, group, claim);
    await travel.returnHome();
    expect(stored.get("startup")).toBeUndefined();
    expect(travel.adventures()).toHaveLength(1);
    expect(messages.at(-1)).toMatch(/could not reach the server/);
    online = true;
    await travel.returnHome();
    expect(claim).toHaveBeenLastCalledWith(island, 0);
    const payload = JSON.parse(stored.get("startup")!) as GameSaveV1;
    expect(payload.archipelago).toMatchObject({ active: null, rewards: { coins: 5, planks: 1 } });
  });

  it("a refused or repeated loot claim pays nothing", async () => {
    const group: Archipelago = { ...addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops }),
      active: 7, home: { map: "home" } as unknown as GameSaveV1 };
    const { simulation } = fakeSimulation({ status: "won" });
    const { stored, travel } = session(simulation, group, async () => ({}));
    expect(await travel.returnHome()).toBe(true);
    expect((JSON.parse(stored.get("startup")!) as GameSaveV1).archipelago!.rewards).toBeUndefined();
  });

  it("keeps a contested adventure filed when sailing home", async () => {
    const group: Archipelago = { ...addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops }),
      active: 7, home: { map: "home" } as unknown as GameSaveV1 };
    const { simulation } = fakeSimulation({ status: "contested" });
    const { stored, travel } = session(simulation, group);
    await travel.returnHome();
    const payload = JSON.parse(stored.get("startup")!) as GameSaveV1;
    expect(payload.archipelago!.adventures).toMatchObject([{ save: { map: "island" }, status: "contested" }]);
  });

  it("at home: releases the expedition and sends the reward ship with the survivors aboard (C12)", () => {
    const rewards = adventureRewardGoods(island);
    const group: Archipelago = { ...emptyArchipelago(), released: [7], returning: troops, rewards };
    const { calls, simulation } = fakeSimulation();
    const { messages, travel } = session(simulation, group);
    travel.colonies();
    expect(calls).toMatchObject({ aboard: troops, received: [], released: [7], roles: ["reward"], ships: [rewards] });
    expect(messages[0]).toMatch(/reward ship/);
    travel.colonies();
    expect(calls.ships).toHaveLength(1);
  });

  it("abandons an unvisited adventure from home: its landing party sails back without a reward", async () => {
    const group = addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops });
    const { calls, simulation } = fakeSimulation();
    const { travel } = session(simulation, group);
    expect(await travel.disband(7)).toBe(true);
    // The landing party sails home on a reward ship of its own (C12: survivors ride the reward ship).
    expect(calls).toMatchObject({ aboard: troops, received: [], released: [7], ships: [{}] });
    expect(travel.adventures()).toEqual([]);
  });
  it("also closes a won adventure when travelling directly to another colony", async () => {
    const group: Archipelago = { ...addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops }),
      active: 7, home: { map: "home" } as unknown as GameSaveV1,
      colonies: [{ expeditionId: 9, status: "conquered", island: { difficulty: "easy", id: 1, name: "Colony",
        ore: "coal", seed: 3, voyageSeconds: 120 }, save: { map: "colony" } as unknown as GameSaveV1 }] };
    const { simulation } = fakeSimulation({ status: "won" });
    const { stored, travel } = session(simulation, group);
    await travel.visit(9);
    const payload = JSON.parse(stored.get("startup")!) as GameSaveV1;
    expect(payload.map).toBe("colony");
    expect(payload.archipelago!.adventures).toBeUndefined();
    expect(payload.archipelago!.released).toEqual([7]);
    expect(payload.archipelago!.returning).toHaveLength(1);
  });

  it("does not re-register an ended expedition while its release is pending", () => {
    const { simulation } = fakeSimulation();
    simulation.releaseColony = () => false;
    simulation.colonyExpeditions = (() => [{ id: 7, status: "arrived", island }]) as typeof simulation.colonyExpeditions;
    simulation.colonyLanding = () => ({ crew: 0, landed: {}, troops });
    const { travel } = session(simulation, { ...emptyArchipelago(), released: [7] });
    expect(travel.adventures()).toEqual([]);
    expect(travel.adventures()).toEqual([]);
  });

});

it("waits for the recording boundary to be preserved before finishing island travel", async () => {
  const { simulation } = fakeSimulation({ status: "won" });
  const initial: Archipelago = { ...addAdventureRecord(emptyArchipelago(), 7, island, { crew: 0, landed: {}, troops }),
    active: 7, home: { map: "home" } as unknown as GameSaveV1 };
  let preserve!: () => void, complete = false, reachedReload!: () => void;
  const started = new Promise<void>(resolve => { reachedReload = resolve; });
  const travel = createArchipelagoSession({ capture: async () => ({ map: "island", settlement: simulation.saveState() }) as GameSaveV1,
    initial, notify: () => {}, simulation, store: createMemorySaveStore().store,
    reload: () => { reachedReload(); return new Promise<void>(resolve => { preserve = resolve; }); } });
  const pending = travel.returnHome().then(result => { complete = true; return result; });
  await started;
  expect(complete).toBe(false);
  preserve(); expect(await pending).toBe(true);
});
