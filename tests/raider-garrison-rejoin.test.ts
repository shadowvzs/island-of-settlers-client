import { describe, expect, it, vi } from "vitest";

import type { MilitaryDoor } from "../src/shared/settlement/military-combat-rules";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSettlementSieges } from "../src/shared/settlement/settlement-siege";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { scriptedRandom } from "../src/shared/settlement/simulation-random";

/**
 * Raiders return home (owner 2026-11-09): a computer field soldier back at its own garrisoned fort
 * goes in again while the fort stands, is not under attack and has room. Riders never do.
 */
const FORT = 12;

const fixture = (inside: number, type: "heavy" | "cavalry" = "heavy") => {
  const fort = { uid: FORT, typeId: 4, construction: 1, militaryFaction: 1, x: 30, z: 30, y: 0,
    access: { x: 30, z: 32 }, doorThreshold: { x: 30, z: 31 }, incoming: {} } as unknown as SettlementBuilding;
  const raider = { uid: 1, x: 30, y: 0, z: 32.5, visible: true, phase: "militaryField", action: "walk",
    path: [{ x: 1, z: 1 }], pathIndex: 0 } as unknown as SettlementActor;
  const soldiers = new Map<number, SettlementSoldier>([[1, { actor: 1, building: -3, rank: 0, stationed: false,
    combat: { cooldown: 0, destination: { x: 30, z: 32 }, faction: 1, hp: 90, order: "move", type } }]]);
  for (let index = 0; index < inside; index++)
    soldiers.set(100 + index, { actor: 100 + index, building: FORT, rank: 0, stationed: true,
      combat: { cooldown: 0, faction: 1, hp: 100, type: "heavy" } });
  const doors = new Map<number, MilitaryDoor>([[FORT, { building: FORT, faction: 1, hp: 200, maximum: 200 }]]);
  const context = { actors: [raider], buildings: [fort], options: { world: { cellsX: 64, cellsZ: 64 } } } as
    unknown as SettlementContext;
  const sieges = createSettlementSieges(context, soldiers, doors, vi.fn(), scriptedRandom("military", () => 0), {
    actorById: id => context.actors.find(actor => actor.uid === id), engaged: () => false,
    heldSeconds: () => 0, steer: () => true });
  return { raider, sieges, soldier: soldiers.get(1)! };
};

describe("raiders rejoin their fort's garrison", () => {
  it("stations the returning raider inside, hidden at the door step", () => {
    const { raider, sieges, soldier } = fixture(2);
    expect(sieges.rejoinGarrison(1, FORT)).toBe(true);
    expect(soldier).toMatchObject({ building: FORT, stationed: true });
    expect(soldier.combat).toMatchObject({ destination: undefined, order: undefined });
    expect(raider).toMatchObject({ phase: "garrison", visible: false, x: 30, z: 31, path: [] });
  });

  it("refuses a full garrison and riders", () => {
    expect(fixture(6).sieges.rejoinGarrison(1, FORT)).toBe(false);
    expect(fixture(0, "cavalry").sieges.rejoinGarrison(1, FORT)).toBe(false);
  });
});
