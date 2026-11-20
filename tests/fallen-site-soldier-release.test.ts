import { describe, expect, it } from "vitest";

import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { releaseFallenSiteSoldiers } from "../src/shared/settlement/settlement-military-site-removal";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

/** MIL-ASSAULT (owner 2026-11-08): soldiers left at a fallen player building lose its protection. */
const TOWER = 5, HQ = 1;
const actor = (uid: number, visible: boolean, phase: string) => ({ uid, x: 3, y: 0, z: 3, visible, phase,
  home: TOWER, building: TOWER, path: [{ x: 4, z: 4 }], pathIndex: 0, action: "walk" }) as unknown as SettlementActor;
const building = (uid: number, typeId: number) => ({ uid, typeId, x: 10, z: 10, width: 2, depth: 2,
  access: { x: 10, z: 12 }, workerApproach: { x: 10, z: 11.5 }, doorThreshold: { x: 10, z: 11 } }) as unknown as SettlementBuilding;
const soldier = (uid: number, stationed: boolean, faction: number): SettlementSoldier =>
  ({ actor: uid, building: TOWER, rank: 0, stationed, combat: { cooldown: 0, faction, hp: 100, type: "shield" } });

describe("soldiers at a fallen player military building", () => {
  it("stand in the field as valid targets, then head back to storage", () => {
    const tower = building(TOWER, 4);
    const actors = [actor(7, false, "garrison"), actor(8, true, "assigned")];
    const context = { actors, buildings: [building(HQ, 0), tower] } as unknown as SettlementContext;
    const soldiers = new Map([[7, soldier(7, true, 0)], [8, soldier(8, false, 0)]]);
    releaseFallenSiteSoldiers(context, soldiers, tower);
    for (const body of actors) expect(body).toMatchObject({ building: HQ, home: HQ, path: [], phase: "militaryField",
      visible: true });
    for (const entry of soldiers.values())
      expect(entry).toMatchObject({ building: -3, combat: { returnToStorage: true }, stationed: false });
    // The hidden garrison soldier steps out in front of the door, not inside the ruin.
    expect(actors[0]!.z).toBeGreaterThan(tower.access.z);
  });
});
