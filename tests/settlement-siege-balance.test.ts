import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { GARRISON_ARCHER_DEAD_ZONE, MILITARY_PROFILES } from "../src/shared/balance/military";
import { fortPlans } from "../src/shared/settlement/colony-island-rules";
import { militaryHealth, type MilitaryTroopType } from "../src/shared/settlement/military-combat-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { exposedGarrisonArchers, garrisonArcherTarget } from "../src/shared/settlement/settlement-garrison-archers";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

type Simulation = ReturnType<typeof createSettlementSimulation>;
const SIZE = 64;
/** Losses of the moderate force before owner decision 2026-10-12 (tower bonus, queue outside the dead zone). */
const LOSSES_BEFORE = 12;

const flatWorld = () => ({ seed: 9, cellsX: SIZE, cellsZ: SIZE, seaLevel: -1, start: { x: 16.5, z: 14.5 },
  heights: new Float32Array((SIZE + 1) ** 2), blocking: new Uint8Array(SIZE ** 2),
  walkCost: new Uint8Array(SIZE ** 2).fill(10), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  oreAmount: new Uint8Array(SIZE ** 2), mineZone: new Uint16Array(SIZE ** 2), mineZones: [],
  props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
}) as unknown as WorldData;

const createFixture = () => {
  const world = flatWorld();
  let simulation: Simulation | undefined;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const created = createSettlementSimulation({ world, roads, initialSettlers: 10,
    initialStock: { planks: 80, stone: 80 }, canWorkerEnterPlot: () => true });
  simulation = created;
  return created;
};

const place = (simulation: Simulation, type: number, x: number, z: number) => {
  const [width, depth] = getBuildingDefinition(type).gridFootprint;
  const result = simulation.placeBuilding(type, x + width % 2 / 2, z + depth % 2 / 2);
  if (!result.ok || !result.building) throw new Error(result.reason);
  result.building.construction = 1; result.building.required = {};
  return result.building;
};

/** A hostile soldier on the first free point in rings around `centre`, like `spawnHostileNear`. */
const spawnNear = (simulation: Simulation, centre: { x: number; z: number }, type: MilitaryTroopType) => {
  for (let ring = 1; ring <= 4; ring++) for (let step = 0; step < 16; step++) {
    const angle = step * Math.PI / 8;
    const id = simulation.spawnMilitaryOpponent({ x: centre.x + Math.cos(angle) * ring * .8,
      z: centre.z + Math.sin(angle) * ring * .8 }, type);
    if (id !== null) return id;
  }
  throw new Error("No defender position");
};

/** An easy adventure fort (watchtower and guardhouse), fully manned like `garrisonFort`. */
const raiseEasyFort = (simulation: Simulation) => {
  const sites = [place(simulation, 4, 40, 40), place(simulation, 2, 50, 40)];
  fortPlans([4, 2], 9, [0]).forEach((plan, index) => {
    const site = sites[index]!, ids = plan.troops.map(type => spawnNear(simulation, site.access, type));
    if (!simulation.registerMilitaryGarrison(site.uid, ids, 1, plan.doorHp)) throw new Error("Garrison refused");
  });
  return sites;
};

/** A moderate force: rank 0 swordsmen and axemen called out of the headquarters. */
const deployForce = (simulation: Simulation, troops: Readonly<Partial<Record<MilitaryTroopType, number>>>) => {
  simulation.receiveTroops(Object.entries(troops).flatMap(([type, count]) => Array.from({ length: count },
    () => ({ hp: militaryHealth(type as MilitaryTroopType, 0), rank: 0, type: type as MilitaryTroopType }))));
  simulation.callOutMilitary(["shield", "heavy"], { x: 20, z: 20 });
  for (let second = 0; second < 60; second++) simulation.update(1);
};

const playerField = (simulation: Simulation) => simulation.militarySoldiers()
  .filter(soldier => (soldier.combat?.faction ?? 0) === 0 && !soldier.stationed && soldier.combat?.type !== "archer");

/** The `besiegeForts` review loop: one siege order per fort until every fort is taken. */
const besiege = (simulation: Simulation, limit = 2400) => {
  const forts = () => simulation.buildings().filter(building => (building.militaryFaction ?? 0) > 0);
  for (let second = 0; second < limit; second++) {
    const [fort] = forts();
    if (!fort) return true;
    const attackers = playerField(simulation);
    if (!attackers.length) return false;
    if (!attackers.some(soldier => soldier.combat?.siege === fort.uid))
      simulation.siegeMilitary(attackers.map(soldier => soldier.actor), fort.uid);
    simulation.update(1);
  }
  return false;
};

const footprintDistance = (site: SettlementBuilding, x: number, z: number) =>
  Math.hypot(Math.max(0, Math.abs(x - site.x) - site.width / 2), Math.max(0, Math.abs(z - site.z) - site.depth / 2));

/** The part of the settlement context the garrison archer rules read. */
const rosterContext = (simulation: Simulation) =>
  ({ buildings: simulation.buildings(), playerNation: "roman" }) as unknown as SettlementContext;

/** Damage of each arrow one garrison archer (watchtower post or barracks window) lands on a standing axeman. */
const garrisonArrowDamage = (typeId: 1 | 4, distance = 5) => {
  const simulation = createFixture();
  const site = place(simulation, typeId, 40, 40);
  const archer = simulation.spawnMilitaryOpponent({ x: site.access.x, z: site.access.z + 1.5 }, "archer", 0, 2)!;
  expect(simulation.registerMilitaryGarrison(site.uid, [archer], 2)).toBe(true);
  const soldiers = new Map(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier]));
  const [exposed] = exposedGarrisonArchers(rosterContext(simulation), soldiers);
  expect(exposed!.facing === null).toBe(typeId === 4);
  const facing = exposed!.facing ?? 0;
  const target = simulation.spawnMilitaryOpponent({ x: exposed!.origin.x + Math.sin(facing) * distance,
    z: exposed!.origin.z + Math.cos(facing) * distance }, "heavy", 0, 1)!;
  const health = () => simulation.militarySoldiers().find(soldier => soldier.actor === target)?.combat?.hp ?? 0;
  const hits: number[] = [];
  for (let step = 0, before = health(); step < 1200 && hits.length < 3 && before > 0; step++) {
    simulation.update(.05);
    const after = health();
    if (after < before) hits.push(Math.round((before - after) * 1000) / 1000);
    before = after;
  }
  return hits;
};

describe("siege balance", () => {
  it("deals the same arrow damage from a tower post as from a window (no tower bonus)", () => {
    const { armour } = MILITARY_PROFILES.heavy, full = MILITARY_PROFILES.archer.damage * (1 - armour[0]!);
    const allowed = [full, full / 2].map(value => Math.round(value * 1000) / 1000);
    const tower = garrisonArrowDamage(4), window = garrisonArrowDamage(1);
    expect(tower.length).toBeGreaterThan(0);
    expect(tower).toEqual(window);
    for (const damage of [...tower, ...window]) expect(allowed).toContain(damage);
  });

  it("lets a tower post archer hit beyond the base bow range, where a window archer cannot (owner request 2026-10-19)", () => {
    const beyond = MILITARY_PROFILES.archer.range + .7;
    expect(garrisonArrowDamage(4, beyond).length).toBeGreaterThan(0);
    expect(garrisonArrowDamage(1, beyond)).toEqual([]);
  });

  it("queues waiting attackers under the walls, on reachable free ground out of the archers' reach", () => {
    const simulation = createFixture();
    const [tower] = raiseEasyFort(simulation);
    deployForce(simulation, { heavy: 4, shield: 8 });
    const ids = playerField(simulation).map(soldier => soldier.actor);
    expect(simulation.siegeMilitary(ids, tower!.uid)).toBe(true);
    const soldiers = () => new Map(simulation.militarySoldiers().map(soldier => [soldier.actor, soldier]));
    const context = rosterContext(simulation);
    let checked = 0;
    for (let second = 0; second < 240 && checked < 3; second++) {
      simulation.update(1);
      const waiting = simulation.militarySoldiers().filter(soldier => soldier.combat?.siege === tower!.uid)
        .map(soldier => simulation.frames().find(body => body.uid === soldier.actor)!)
        .filter(body => body.phase === "militaryField" && body.action === "idle" && !body.path.length);
      if (waiting.length < 4) continue;
      checked++;
      const enemies = waiting.map(body => ({ ...body, soldier: soldiers().get(body.uid)! }));
      for (const body of waiting) {
        expect(footprintDistance(tower!, body.x, body.z)).toBeLessThan(GARRISON_ARCHER_DEAD_ZONE);
        expect(simulation.isOccupied(body.x, body.z)).toBe(false);
      }
      for (const archer of exposedGarrisonArchers(context, soldiers()))
        if (archer.building === tower!.uid) expect(garrisonArcherTarget(archer, enemies)).toBeUndefined();
    }
    expect(checked).toBe(3);
  });

  it("captures an easy fort with a moderate force and fewer losses than before", () => {
    const simulation = createFixture();
    raiseEasyFort(simulation);
    deployForce(simulation, { heavy: 4, shield: 8 });
    const before = playerField(simulation).length;
    expect(before).toBe(12);
    expect(besiege(simulation)).toBe(true);
    const survivors = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0).length;
    // Seed 9: 8 of 12 fall (seeds 1-5: 7-8); before 2026-10-12 all 12 fell and the fort held.
    expect(before - survivors).toBeLessThan(LOSSES_BEFORE);
  });
});
