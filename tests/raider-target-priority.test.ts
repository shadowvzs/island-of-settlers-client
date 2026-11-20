import { describe, expect, it, vi } from "vitest";

import {
  createColonyCounterattacks, RAID_NEARBY_SOLDIER_RADIUS
} from "../src/shared/settlement/settlement-colony-counterattack";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

/**
 * Raider priority (owner 2026-11-09): counterattack raiders attack player soldiers near the raider
 * or its target first; farther soldiers are ignored and the raiders besiege the target. A soldier
 * arriving mid-siege pulls the besiegers off the walls. With nothing left to fight they go home.
 */
const RAIDER = 1, TROOP = 2, TOWER = 10, HQ = 11, FORT = 12;

const body = (uid: number, x: number, z = 0) =>
  ({ uid, x, z, y: 0, phase: "militaryField", visible: true, path: [], pathIndex: 0 }) as unknown as SettlementActor;
const site = (uid: number, typeId: number, x: number, militaryFaction?: number) => ({ uid, typeId, construction: 1,
  x, z: 0, access: { x, z: 1 }, militaryFaction }) as unknown as SettlementBuilding;

interface RaidSetup {
  atDoor?: boolean;
  civilianInReach?: boolean;
  raider?: { x: number; z?: number; siege?: number };
  siegeAccepted?: boolean;
  tower?: boolean;
  troop?: { x: number; z?: number };
}

const raid = ({
  atDoor = false, civilianInReach = false, raider = { x: 0 }, siegeAccepted = true, tower = true, troop
}: RaidSetup) => {
  const actors = [body(RAIDER, raider.x, raider.z), ...(troop ? [body(TROOP, troop.x, troop.z)] : [])];
  const buildings = [site(HQ, 0, -30), site(FORT, 4, 60, 1), ...(tower ? [site(TOWER, 16, 12, 0)] : [])];
  const soldiers: SettlementSoldier[] = [
    { actor: RAIDER, building: -3, rank: 0, stationed: false,
      combat: { cooldown: 0, faction: 1, hp: 100, siege: raider.siege, type: "heavy" } },
    ...(troop ? [{ actor: TROOP, building: -3, rank: 0, stationed: false,
      combat: { cooldown: 0, faction: 0, hp: 100, type: "shield" as const } }] : [])
  ];
  const combat = {
    atDoor: vi.fn(() => atDoor), civilianInReach: vi.fn(() => civilianInReach),
    commandOpponent: vi.fn(() => true),
    doors: () => [{ building: TOWER, faction: 0, hp: 200, maximum: 200, structure: { hp: 27_500, maximum: 27_500 } }],
    rejoinGarrison: vi.fn(() => true), siegeOpponent: vi.fn(() => siegeAccepted), withdrawOpponent: vi.fn(() => true)
  };
  const military = { combat, soldiers: () => soldiers, troopType: () => "heavy" };
  const context = { actors, buildings, options: { world: {} } } as unknown as SettlementContext;
  const attacks = createColonyCounterattacks(context, military as never);
  attacks.restore({ landTime: 1e9, raiders: [RAIDER], shipTime: 1e9 });
  attacks.update(.05, "medium", true);
  return combat;
};

describe("counterattack raider target priority", () => {
  it("names one 18-tile radius for nearby soldiers", () => {
    expect(RAID_NEARBY_SOLDIER_RADIUS).toBe(18);
  });

  it("fights a soldier 15 tiles away first, but besieges past one 20 tiles away", () => {
    // Behind the raider, so 27 and 32 tiles from the tower.
    const near = raid({ troop: { x: -15 } });
    expect(near.siegeOpponent).not.toHaveBeenCalled();
    expect(near.commandOpponent).toHaveBeenCalledWith([RAIDER], expect.objectContaining({ uid: TROOP }), 1);
    const far = raid({ troop: { x: -20 } });
    expect(far.commandOpponent).not.toHaveBeenCalled();
    expect(far.siegeOpponent).toHaveBeenCalledWith([RAIDER], TOWER, 1);
  });

  it("ignores a far player soldier and besieges the tower", () => {
    // 40 tiles from the raider, 28 from the tower.
    const combat = raid({ troop: { x: 40 } });
    expect(combat.commandOpponent).not.toHaveBeenCalled();
    expect(combat.siegeOpponent).toHaveBeenCalledWith([RAIDER], TOWER, 1);
  });

  it("marches on a soldier within the radius of the raider first", () => {
    const combat = raid({ troop: { x: -11 } });
    expect(combat.siegeOpponent).not.toHaveBeenCalled();
    expect(combat.commandOpponent).toHaveBeenCalledWith([RAIDER], expect.objectContaining({ uid: TROOP }), 1);
  });

  it("marches on a soldier within the radius of the target, even far from the raider", () => {
    // 25 tiles from the raider, 13 from the tower's access.
    const combat = raid({ troop: { x: 25, z: 1 } });
    expect(combat.siegeOpponent).not.toHaveBeenCalled();
    expect(combat.commandOpponent).toHaveBeenCalledWith([RAIDER], expect.objectContaining({ uid: TROOP }), 1);
  });

  it("besieges the player's tower once no troop is left", () => {
    const combat = raid({});
    expect(combat.siegeOpponent).toHaveBeenCalledWith([RAIDER], TOWER, 1);
    expect(combat.commandOpponent).not.toHaveBeenCalled();
  });

  it("marches on the building when the siege is refused", () => {
    const combat = raid({ siegeAccepted: false });
    expect(combat.commandOpponent).toHaveBeenCalledWith([RAIDER], { x: 12, z: 1 }, 1);
  });

  it("pulls a besieger off the walls when a soldier comes near; a far one leaves the siege alone", () => {
    const pulled = raid({ raider: { x: 11, siege: TOWER }, troop: { x: 20, z: 1 } });
    expect(pulled.commandOpponent).toHaveBeenCalledWith([RAIDER], expect.objectContaining({ uid: TROOP }), 1);
    const kept = raid({ raider: { x: 11, siege: TOWER }, troop: { x: 50 } });
    expect(kept.commandOpponent).not.toHaveBeenCalled();
    expect(kept.siegeOpponent).not.toHaveBeenCalled();
  });

  it("keeps a besieger in its door fight even with a soldier near", () => {
    const fight = raid({ atDoor: true, raider: { x: 11, siege: TOWER }, troop: { x: 14 } });
    expect(fight.atDoor).toHaveBeenCalledWith(RAIDER);
    expect(fight.commandOpponent).not.toHaveBeenCalled();
  });

  it("hunts the civilians at the overrun base, then walks home and goes back in", () => {
    // No player military building left: the raid stands at the headquarters.
    const hunting = raid({ civilianInReach: true, raider: { x: -28 }, tower: false });
    expect(hunting.commandOpponent).not.toHaveBeenCalled();
    const done = raid({ raider: { x: -28 }, tower: false });
    expect(done.commandOpponent).toHaveBeenCalledWith([RAIDER], { x: 60, z: 1 }, 1, "move");
    const home = raid({ raider: { x: 59, z: 1 }, tower: false });
    expect(home.rejoinGarrison).toHaveBeenCalledWith(RAIDER, FORT);
    expect(home.withdrawOpponent).not.toHaveBeenCalled();
  });

  it("marches on the overrun base first when it is still far away", () => {
    const combat = raid({ raider: { x: 20 }, tower: false });
    expect(combat.commandOpponent).toHaveBeenCalledWith([RAIDER], { x: -30, z: 1 }, 1);
  });
});
