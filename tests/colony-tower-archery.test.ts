import { expect, it } from "vitest";

import { createMilitaryArchery } from "../src/shared/settlement/military-archery";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { scriptedRandom } from "../src/shared/settlement/simulation-random";

it.each([true, false])("preserves the colony tower shot bonus after save and shooter death (colony %s)", colony => {
  const guard = { actor: 1, building: 7, rank: 0, stationed: true,
    combat: { cooldown: 0, faction: 1, hp: 56.25, type: "archer" } } as SettlementSoldier;
  const target = { actor: 2, building: -3, rank: 0, stationed: false,
    combat: { cooldown: 0, faction: 0, hp: 75, type: "shield" } } as SettlementSoldier;
  const actors = [{ uid: 1, x: 20, y: 1, z: 20, phase: "garrison", visible: false },
    { uid: 2, x: 25, y: 1, z: 20, phase: "militaryField", visible: true, action: "idle", yaw: 0 }] as SettlementActor[];
  const context = { buildings: [{ construction: 1, depth: 4, rotation: 0, typeId: 4, uid: 7,
    width: 5, x: 20, y: 1, z: 20 }], playerNation: "roman", actors,
    options: { homeBuilding: colony ? 39 : 0, world: { cellsX: 48, cellsZ: 48,
      heights: new Float32Array(49 * 49) } } } as unknown as SettlementContext;
  const soldiers = new Map([[1, guard], [2, target]]);
  const archery = createMilitaryArchery(context, soldiers, scriptedRandom("military", () => .5), id => actors.find(actor => actor.uid === id));
  const hits: number[] = [];
  const hit = (_a: unknown, _b: unknown, _full: boolean, _blank?: boolean, multiplier = 1) => { hits.push(multiplier); };
  for (let tick = 0; tick < 40 && !archery.arrows().length; tick++) archery.update(.05, [actors[1]!], hit);
  expect(archery.arrows().length).toBeGreaterThan(0);
  const save = JSON.parse(JSON.stringify(archery.save()));
  expect(save.arrows[0].damageMultiplier).toBe(colony ? 1.5 : 1);
  archery.restore(save); soldiers.delete(1);
  for (let tick = 0; tick < 40; tick++) archery.update(.05, [actors[1]!], hit);
  expect(hits).toContain(colony ? 1.5 : 1);
});
