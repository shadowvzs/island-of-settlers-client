import { expect, it, vi } from "vitest";

import { createMilitaryArchery } from "../src/shared/settlement/military-archery";
import {
  CATAPULT_IMPACT_RADIUS, catapultImpactFraction, resolveCatapultImpact
} from "../src/shared/settlement/military-catapult-impact";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import type { MilitaryArrow } from "../src/shared/settlement/military-projectiles";
import { createMilitarySpatialGrid } from "../src/shared/settlement/military-spatial-grid";
import { createCombatCasualties } from "../src/shared/settlement/settlement-combat-core";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import type { AuditedRandom } from "../src/shared/settlement/simulation-random";

it("applies the exact80%/30% distance boundaries inside the compact impact radius", () => {
  expect(CATAPULT_IMPACT_RADIUS).toBe(.75);
  expect(catapultImpactFraction(0)).toBe(1);
  expect(catapultImpactFraction(.15)).toBe(1);
  expect(catapultImpactFraction(.150001)).toBe(.5);
  expect(catapultImpactFraction(.525)).toBe(.5);
  expect(catapultImpactFraction(.525001)).toBe(.35);
  expect(catapultImpactFraction(.75)).toBe(.35);
  expect(catapultImpactFraction(.750001)).toBe(0);
});

it("scales impact damage and withholding a kill for limestone", () => {
  const defender = { actor: 2, building: -3, rank: 0, stationed: false,
    combat: { type: "heavy", faction: 1, hp: 100, cooldown: 0 } } as SettlementSoldier;
  const soldiers = new Map([[2, defender]]);
  const grid = createMilitarySpatialGrid<{ id: number; x: number; y: number; z: number; faction: number }>(32, 32);
  grid.rebuild([{ id: 2, x: 10, y: 0, z: 10, faction: 1 }]);
  const arrow = { id: 1, shooter: 99, rank: 0, faction: 0, x: 10, y: 2, z: 10, vx: 0, vy: 0, vz: 0,
    age: 0, boulder: { kind: "limestone", target: 2, x: 10, y: 0, z: 10 } } as MilitaryArrow;
  const hit = vi.fn();
  resolveCatapultImpact({ commander: undefined } as unknown as SettlementContext, arrow, grid, soldiers, hit);
  expect(hit).toHaveBeenCalledTimes(1);
  expect(hit.mock.calls[0]![6]).toBe(false);
  expect(hit.mock.calls[0]![7]).toBe(militaryHealth("heavy", 0) * .6);
});

it("applies 35% damage and the half impact radius to granite fragments", () => {
  const defender = { actor: 2, building: -3, rank: 0, stationed: false,
    combat: { type: "heavy", faction: 1, hp: 100, cooldown: 0 } } as SettlementSoldier;
  const soldiers = new Map([[2, defender]]);
  const grid = createMilitarySpatialGrid<{ id: number; x: number; y: number; z: number; faction: number }>(32, 32);
  grid.rebuild([{ id: 2, x: 10, y: 0, z: 10, faction: 1 }]);
  const arrow = { id: 1, shooter: 99, rank: 0, faction: 0, x: 10, y: 2, z: 10, vx: 0, vy: 0, vz: 0,
    age: 0, boulder: { fragment: true, kind: "granite", target: 2, x: 10, y: 0, z: 10 } } as MilitaryArrow;
  const hit = vi.fn();
  resolveCatapultImpact({ commander: undefined } as unknown as SettlementContext, arrow, grid, soldiers, hit);
  expect(hit).toHaveBeenCalledTimes(1);
  expect(hit.mock.calls[0]![6]).toBe(false);
  expect(hit.mock.calls[0]![7]).toBe(militaryHealth("heavy", 0) * .35);
});

it("hits every current enemy body in the radius, including other factions, after the shooter disappears", () => {
  const soldiers = new Map<number, SettlementSoldier>(), bodies: SettlementActor[] = [];
  for (const [id, distance, faction, y] of [[2, 0, 1, 0], [3, .15, 1, 0], [4, .3, 1, 0],
    [5, .525, 1, 0], [6, .6, 1, 0], [7, .75, 1, 0], [8, .75001, 1, 0], [9, 0, 0, 0], [10, .3, 2, 0], [11, 0, 1, 2]]) {
    soldiers.set(id!, { actor: id!, building: -3, rank: 3, stationed: false,
      combat: { type: "heavy", faction: faction!, hp: 100, cooldown: 0 } });
    bodies.push({ uid: id!, x: 10 + distance!, z: 10, y, visible: true, phase: "militaryField" } as SettlementActor);
  }
  soldiers.get(10)!.commanderId = "commander";
  const context = { buildings: [], actors: bodies, playerNation: "roman", options: { world: { cellsX: 32, cellsZ: 32 } },
    commander: { snapshotAny: () => ({ id: "commander", maximumHp: 500 }) } } as unknown as SettlementContext;
  const random = { at: () => () => .5 } as unknown as AuditedRandom;
  const archery = createMilitaryArchery(context, soldiers, random, id => bodies.find(body => body.uid === id));
  const projectile = { id: 1, shooter: 99, rank: 0, faction: 0, x: 10, y: 2, z: 10, vx: 0, vy: 0, vz: 0,
    age: 0, boulder: { target: 2, x: 10, y: 0, z: 10 } } as MilitaryArrow;
  projectile.wall = 77;
  archery.restore({ arrows: [projectile], nextArrow: 2 });
  const hit = vi.fn(), wallHit = vi.fn();
  archery.update(1.5, bodies, hit, wallHit);
  expect(wallHit).not.toHaveBeenCalled();
  expect(hit.mock.calls.map(call => call[1].actor)).toEqual([2, 3, 4, 5, 6, 7, 10]);
  const hits = new Map(hit.mock.calls.map(call => [call[1].actor, { kill: call[6], damage: call[7] }]));
  expect(hits.get(2)!.kill).toBe(true); expect(hits.get(3)!.kill).toBe(true);
  expect(hits.get(4)!.damage).toBe(militaryHealth("heavy", 3) * .5);
  expect(hits.get(6)!.damage).toBe(militaryHealth("heavy", 3) * .35);
  expect(hits.get(10)!.damage).toBe(250);
  expect(archery.save().arrows).toHaveLength(1);
  expect(archery.save().arrows[0]!.boulder?.restAge).toBe(0);
});

it("subtracts fixed max-HP damage through real casualty handling without armour, dodge or random rolls", () => {
  const victim = { actor: 2, rank: 0, building: -3, stationed: false,
    combat: { type: "heavy", faction: 1, hp: 60, cooldown: 0 } } as SettlementSoldier;
  const attacker = { ...victim, actor: 1, combat: { ...victim.combat!, faction: 0 } };
  const removed = vi.fn();
  const deps = { actorById: () => ({ uid: 2, x: 0, y: 0, z: 0 }), context: { options: {} }, deaths: [],
    initialize: (soldier: SettlementSoldier) => soldier.combat!, knowledge: { alert: () => undefined },
    memoryOf: () => ({}), inField: () => false,
    random: { at: () => { throw new Error("Fixed boulder tiers must not roll damage"); } }, removeSoldier: removed
  } as unknown as Parameters<typeof createCombatCasualties>[0];
  const { hit } = createCombatCasualties(deps);
  hit(attacker, victim, true, false, 1, false, false, 50);
  expect(victim.combat!.hp).toBe(10); expect(removed).not.toHaveBeenCalled();
  hit(attacker, victim, true, false, 1, false, false, 35);
  expect(victim.combat!.hp).toBe(0); expect(removed).toHaveBeenCalledTimes(1);
});

it("restores a mid-flight shot and checks the bodies at impact rather than the original target", () => {
  const bodies = [
    { uid: 2, x: 10, y: 0, z: 10, visible: true, phase: "militaryField" },
    { uid: 3, x: 14, y: 0, z: 10, visible: true, phase: "militarySiege" }
  ] as SettlementActor[];
  const soldiers = new Map(bodies.map(body => [body.uid, { actor: body.uid, rank: 0, stationed: false,
    building: -3, combat: { type: "heavy", faction: 1, hp: 100, cooldown: 0 } } as SettlementSoldier]));
  const context = { actors: bodies, buildings: [], playerNation: "roman",
    options: { world: { cellsX: 32, cellsZ: 32 } } } as unknown as SettlementContext;
  const random = { at: () => () => .5 } as unknown as AuditedRandom;
  const create = () => createMilitaryArchery(context, soldiers, random, id => bodies.find(body => body.uid === id));
  const first = create(), hit = vi.fn();
  first.restore({ nextArrow: 2, arrows: [{ id: 1, shooter: 99, faction: 0, rank: 0,
    x: 10, y: 2, z: 10, vx: 0, vy: 0, vz: 0, age: 0,
    boulder: { target: 2, x: 10, y: 0, z: 10 } } as MilitaryArrow] });
  first.update(.7, bodies, hit, vi.fn());
  expect(hit).not.toHaveBeenCalled();
  const restored = create(); restored.restore(JSON.parse(JSON.stringify(first.save())));
  bodies[0]!.x = 12;
  bodies[1]!.x = 10.3;
  // Door defenders are deliberately absent from the bow field list but remain physical blast targets.
  restored.update(.8, [], hit, vi.fn());
  expect(hit.mock.calls.map(call => call[1].actor)).toEqual([3]);
  expect(hit.mock.calls[0]![7]).toBe(militaryHealth("heavy", 0) * .5);
});
