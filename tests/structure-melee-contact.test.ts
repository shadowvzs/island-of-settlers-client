import { expect, it, vi } from "vitest";

import { banditSiteRef, placedBanditCamp } from "../src/render-common/buildings/bandit-camp-plan";
import type { MilitaryCombatant, MilitaryDoor } from "../src/shared/settlement/military-combat-rules";
import { createStructureAssault } from "../src/shared/settlement/military-structure-assault";
import { footprintDistance, structureAttackFootprint } from "../src/shared/settlement/settlement-garrison-archers";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { scriptedRandom } from "../src/shared/settlement/simulation-random";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

/** `bandit:outlawStronghold`, first layout. */
const STRONGHOLD = banditSiteRef(2, 0);

it.each([0, 1, 2, 3])("requires contact with visible hall walls, including rotation %s and release-time checks", rotation => {
  const size = 48;
  const world = { cellsX: size, cellsZ: size, seaLevel: -1,
    heights: new Float32Array((size + 1) ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  const site = { uid: 9, typeId: 9, x: 24, z: 24, y: 0, rotation,
    ...placedBanditCamp(STRONGHOLD, 24, 24, rotation), bandit: STRONGHOLD, enemyCampEnclosure: "building",
    militaryFaction: 1, construction: 1 } as SettlementBuilding;
  const actor = { uid: 1, x: 24 - Math.cos(rotation * Math.PI / 2) * 4.5,
    z: 24 + Math.sin(rotation * Math.PI / 2) * 4.5, y: 0, mounted: false, path: [], pathIndex: 0,
    visible: true } as unknown as SettlementActor;
  const state = { faction: 0, type: "heavy", siege: 9 } as MilitaryCombatant;
  const soldier = { actor: 1, building: -3, rank: 0, combat: state } as SettlementSoldier;
  const door = { building: 9, faction: 1, structure: { hp: 1000, maximum: 1000 } } as MilitaryDoor;
  const context = { options: { world }, actors: [actor], buildings: [site],
    occupied: new Uint8Array(size ** 2), reservations: new Set() } as unknown as SettlementContext;
  const plan = vi.fn();
  const assault = createStructureAssault(context, { actorById: () => actor,
    doors: new Map([[9, door]]), soldiers: new Map([[1, soldier]]), plan,
    stand: () => {}, walk: () => {}, fireAtWall: () => {},
    random: scriptedRandom("military", () => 0) });
  expect(assault.update(actor, state, .05)).toBe(true);
  expect(state.attackTime).toBeUndefined();
  const point = plan.mock.calls[0]![2];
  expect(footprintDistance(structureAttackFootprint(site), point.x, point.z)).toBeLessThanOrEqual(.9);
  Object.assign(actor, point);
  assault.update(actor, state, .05);
  expect(state.attackTime).toBe(.6);
  actor.x = 5; actor.z = 5;
  assault.release(actor, soldier, state);
  expect(door.structure!.hp).toBe(1000);
});
