import { describe, expect, it } from "vitest";

import { createColonyEconomy } from "../src/app/settlement/colony-economy-session";
import {
type Archipelago, type ColonyEvacuation,
  expireColony, validateArchipelago} from "../src/shared/settlement/archipelago";
import { addToHome } from "../src/shared/settlement/colony-economy";
import {
  garrisonShortfall, idleShipCount, sendIdleShipsAway, shipLoads, takeHomeReserves
} from "../src/shared/settlement/colony-troop-supply";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { composeGameSave, liftSessionEvacuations, splitGameSave } from "../src/shared/settlement/game-save-rows";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import type { SettlementSaveV1 } from "../src/shared/settlement/settlement-save-state";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { Goods } from "../src/shared/settlement/settlement-types";

const MINUTE = 60_000;
const island = { difficulty: "easy" as const, id: 0, name: "Gull Rock", ore: "coal" as const, seed: 1,
  voyageSeconds: 120 };
const troop = (type: EmigratedTroop["type"] = "shield"): EmigratedTroop => ({ hp: militaryHealth(type, 0), rank: 0, type });
const soldierRow = (actor: number, type: EmigratedTroop["type"], building = -1) =>
  ({ actor, building, combat: { cooldown: 0, faction: 0, hp: militaryHealth(type, 0), type }, rank: 0, stationed: false });

/** A filed home island: a harbour, stored soldiers (`types`) and `ships` idle ships. */
const homeSave = (types: readonly EmigratedTroop["type"][], ships = 2) => ({
  actors: types.map((_type, index) => ({ home: 1, phase: "militaryReserve", uid: 100 + index })),
  buildings: [{ construction: 1, inventory: {}, typeId: 0, uid: 0 }, { construction: 1, inventory: {}, typeId: 39, uid: 1 }],
  military: { soldiers: types.map((type, index) => soldierRow(100 + index, type)) },
  naval: { fleet: { ships: Array.from({ length: ships }, (_, index) =>
    ({ cargo: {}, cursor: 0, id: index + 1, phase: "idle", route: [], timer: 0, x: 10 + index, z: 50 })) } }
}) as unknown as SettlementSaveV1;

describe("colony troop supply rules", () => {
  it("asks for archers on empty tower posts and melee elsewhere, minus stored and incoming soldiers", () => {
    const watchtower = { assignedTroops: { archer: 1, heavy: 0, shield: 1 }, manual: null, target: 6, typeId: 4 };
    const barracks = { assignedTroops: { archer: 0, heavy: 0, shield: 0 }, manual: null, target: 2, typeId: 1 };
    expect(garrisonShortfall([watchtower, barracks], {})).toEqual({ archer: 2, melee: 4 });
    expect(garrisonShortfall([watchtower, barracks], { archer: 3, shield: 1 })).toEqual({ archer: 0, melee: 2 });
    expect(garrisonShortfall([watchtower], { shield: 5 })).toEqual({ archer: 0, melee: 0 });
  });

  it("takes stored home soldiers out of the filed save, archers for the posts first", () => {
    const save = homeSave(["shield", "archer", "heavy", "shield", "archer"]);
    const troops = takeHomeReserves(save, { archer: 1, melee: 2 }, 16);
    expect(troops.map(entry => entry.type)).toEqual(["archer", "shield", "shield"]);
    expect(save.military!.soldiers.map(soldier => soldier.combat!.type)).toEqual(["heavy", "archer"]);
    expect(save.actors.map(actor => actor.uid)).toEqual([102, 104]);
    expect(takeHomeReserves(save, { archer: 0, melee: 9 }, 1)).toHaveLength(1);
  });

  it("fills each ship deck before the next and sends idle home ships away for the round trip", () => {
    const loads = shipLoads(Array.from({ length: 20 }, () => troop()), { stone: 8 });
    expect(loads.map(load => load.troops.length)).toEqual([16, 4]);
    expect(loads[1]!.cargo).toEqual({ stone: 8 });
    const save = homeSave([], 3);
    expect(idleShipCount(save)).toBe(3);
    expect(sendIdleShipsAway(save, 2, { expeditionId: 7, voyageSeconds: 60 }, loads)).toBe(2);
    expect(save.naval.fleet.ships.map(ship => ship.phase)).toEqual(["away", "away", "idle"]);
    expect(save.naval.fleet.ships[0]).toMatchObject({ colony: { expeditionId: 7 }, sourceUid: 1, timer: 120 });
    expect(save.naval.fleet.ships[0]!.colony!.manifest).toMatchObject({ troops: { shield: 16 } });
    expect(idleShipCount(save)).toBe(1);
  });
});

const fakeSimulation = (need = { archer: 0, melee: 0 }) => {
  const visitors: EmigratedTroop[][] = [], fetched: number[] = [], received: EmigratedTroop[] = [];
  const home = { construction: 1, inventory: {} as Goods, typeId: 0 };
  let freeShips = 0;
  const simulation = {
    buildings: () => [home], colony: () => ({ status: "conquered" }),
    fetchFromColony: (_voyage: object, load: { troops: EmigratedTroop[] }) =>
      freeShips-- > 0 ? fetched.push(load.troops.length) : null,
    garrisonShortfall: () => need,
    receiveHomeGoods: (goods: Goods) => addToHome([home], goods),
    receiveTroops: (troops: EmigratedTroop[]) => received.push(...troops),
    sendVisitorShip: (_cargo: Goods, _pickup: string[], _role: string, troops: EmigratedTroop[]) =>
      visitors.push(troops)
  } as unknown as SettlementSimulation;
  return { fetched, home, received, setFreeShips: (count: number) => { freeShips = count; }, simulation, visitors };
};

const session = (simulation: SettlementSimulation, group: Archipelago, clock: { now: number }) => {
  let current = group;
  const messages: string[] = [];
  const economy = createColonyEconomy({ group: () => current, notify: text => messages.push(text),
    now: () => clock.now, setGroup: next => { current = next; }, simulation });
  return { economy, group: () => current, messages };
};

describe("colony troop ships", () => {
  it("brings stored home soldiers to a conquered colony's military buildings on idle home ships", () => {
    const fake = fakeSimulation({ archer: 2, melee: 18 });
    const home = homeSave([...Array(30).fill("shield"), "archer", "archer"], 2);
    const group: Archipelago = { active: 4, colonies: [{ expeditionId: 4, island, status: "conquered" }],
      home: { settlement: home } as unknown as GameSaveV1, version: 1 };
    const { economy, messages } = session(fake.simulation, group, { now: 0 });
    economy.update(5);
    expect(fake.visitors.map(troops => troops.length)).toEqual([16, 4]);
    expect(fake.visitors.flat().filter(entry => entry.type === "archer")).toHaveLength(2);
    expect(home.military!.soldiers).toHaveLength(12);
    expect(home.naval.fleet.ships.every(ship => ship.phase === "away")).toBe(true);
    expect(messages).toEqual(["2 ships from home bring 20 soldiers for the military buildings."]);
  });

  it("sends nothing while the colony is contested or no home ship is idle", () => {
    const fake = fakeSimulation({ archer: 0, melee: 4 });
    const home = homeSave(Array(8).fill("shield"), 0);
    const group: Archipelago = { active: 4, colonies: [{ expeditionId: 4, island, status: "conquered" }],
      home: { settlement: home } as unknown as GameSaveV1, version: 1 };
    session(fake.simulation, group, { now: 0 }).economy.update(5);
    expect(fake.visitors).toEqual([]);
    expect(home.military!.soldiers).toHaveLength(8);
  });

  it("fetches a freed colony's soldiers and wares with idle ships, the rest after ten minutes at once", () => {
    const fake = fakeSimulation();
    const evacuation: ColonyEvacuation = { cargo: { stone: 40 }, deadline: 10 * MINUTE, expeditionId: 4,
      name: "Gull Rock", troops: Array.from({ length: 20 }, () => troop()), voyageSeconds: 120 };
    const clock = { now: 0 };
    const { economy, group, messages } = session(fake.simulation,
      { active: null, colonies: [], evacuations: [evacuation], version: 1 }, clock);
    fake.setFreeShips(1);
    economy.update(5);
    expect(fake.fetched).toEqual([16]);
    expect(group().evacuations![0]).toMatchObject({ cargo: { stone: 40 }, troops: Array(4).fill(troop()) });
    clock.now = 10 * MINUTE;
    economy.update(5);
    expect(fake.received).toHaveLength(4);
    expect(fake.home.inventory).toEqual({ stone: 40 });
    expect(group().evacuations).toBeUndefined();
    expect(messages.at(-1)).toBe("Gull Rock: remaining troops and goods returned to the home harbour.");
  });
});

describe("colony evacuation records", () => {
  const colonySave = {
    settlement: {
      buildings: [{ construction: 1, colonyHome: true, inventory: { fish: 3, stone: 12 }, typeId: 39, uid: 1 },
        { construction: 1, inventory: { coal: 5 }, typeId: 11, uid: 2 }],
      military: { soldiers: [soldierRow(5, "archer", 3), { ...soldierRow(6, "heavy"), combat:
        { cooldown: 0, faction: 1, hp: 50, type: "heavy" } }] }
    }
  } as unknown as GameSaveV1;

  it("frees an expired colony and immediately queues every stock and survivor for the home harbour", () => {
    const group: Archipelago = { active: null, colonies: [{ conqueredAt: 0, expeditionId: 4, island,
      save: colonySave, status: "conquered" }], version: 1 };
    const expired = expireColony(group, group.colonies[0]!, 100);
    expect(expired.colonies).toEqual([]);
    expect(expired.released).toEqual([4]);
    expect(expired.returning).toEqual([]);
    expect(expired.evacuations).toEqual([{ cargo: { fish: 3, stone: 12, coal: 5 }, deadline: 100,
      expeditionId: 4, name: "Gull Rock", troops: [troop("archer")], voyageSeconds: 120 }]);
    expect(validateArchipelago(expired)).toBeNull();
    expect(validateArchipelago({ ...expired, evacuations: [{ ...expired.evacuations![0], troops: [{ type: "x" }] }]}))
      .toBe("Invalid colony evacuation");
  });

  it("keeps waiting evacuations in their own rows across save and load", () => {
    const evacuations = [{ cargo: { stone: 2 }, deadline: 5, expeditionId: 4, name: "Gull Rock",
      troops: [troop()], voyageSeconds: 120 }];
    const save = { archipelago: { active: null, colonies: [], evacuations, version: 1 }, savedAt: 1,
      settlement: {} } as unknown as GameSaveV1;
    const rows = splitGameSave(save);
    expect(rows.evacuations).toEqual(evacuations);
    expect(rows.session.evacuations).toBeUndefined();
    expect(composeGameSave(rows)!.archipelago!.evacuations).toEqual(evacuations);
    // Rows written before database version 5 kept them in the session row.
    const older = { ...rows, evacuations: undefined, session: { ...rows.session, evacuations } };
    expect(liftSessionEvacuations(older)).toEqual(rows);
    expect(composeGameSave(older)!.archipelago!.evacuations).toEqual(evacuations);
  });
});
