import { describe, expect, it } from "vitest";

import { createPlayerSession } from "../src/app/settlement/player-session";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import type { SettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../src/shared/settlement/settlement-types";

/** A home island (headquarters) whose buildings the test edits. */
const homeIsland = (buildings: Array<Partial<SettlementBuilding>>) => ({
  buildings: () => buildings, home: () => ({ typeId: 0 }), islandRole: () => "home", playerNation: () => "roman",
  receiveHomeGoods: () => true, setTalentRanks: () => true
}) as unknown as SettlementSimulation;

const house = { construction: 1, typeId: 17, uid: 1 } as SettlementBuilding;
const monumentSite = { construction: 0.5, typeId: BuildingType.Monument, uid: 2 };

const sessionOn = (simulation: SettlementSimulation) => {
  const session = createPlayerSession({ now: () => 0, seed: 3 });
  session.bind(simulation);
  return session;
};

describe("Monument experience in the player session", () => {
  it("gives no bonus without a Monument or while it is under construction", () => {
    for (const buildings of [[house], [house, monumentSite]]) {
      const session = sessionOn(homeIsland(buildings));
      session.buildingCompleted(house);
      const plain = session.progress().experience;
      expect(plain).toBeGreaterThan(0);
      expect(session.monumentBonusActive()).toBe(false);
    }
  });

  it("adds 25 % once the Monument stands, not on its own completion, and stops after demolition", () => {
    const buildings: Array<Partial<SettlementBuilding>> = [house, { ...monumentSite }];
    const plain = sessionOn(homeIsland([house]));
    plain.buildingCompleted(house);
    const base = plain.progress().experience;
    const session = sessionOn(homeIsland(buildings));
    buildings[1]!.construction = 1;
    session.buildingCompleted(buildings[1] as SettlementBuilding);
    const afterMonument = session.progress().experience;
    expect(session.monumentBonusActive()).toBe(true);
    session.buildingCompleted(house);
    expect(session.progress().experience - afterMonument).toBe(base + Math.floor(base / 4));
    buildings.pop();
    session.buildingRemoved();
    expect(session.monumentBonusActive()).toBe(false);
    const beforePlain = session.progress().experience;
    session.buildingCompleted(house);
    expect(session.progress().experience - beforePlain).toBe(base);
  });

  it("applies the home flag away from home (colony session) without re-reading the colony", () => {
    const home = sessionOn(homeIsland([house, { ...monumentSite, construction: 1 }]));
    const colony = { ...homeIsland([house]), home: () => ({ colonyHome: true, typeId: 39 }),
      islandRole: () => "colony" } as unknown as
      SettlementSimulation;
    const away = createPlayerSession({ initial: home.progress(), now: () => 0, seed: 3 });
    away.bind(colony);
    expect(away.monumentBonusActive()).toBe(true);
  });
});
