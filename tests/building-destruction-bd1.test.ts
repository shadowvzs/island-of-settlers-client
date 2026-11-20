import { describe, expect, it, vi } from "vitest";

import { buildingsWithRules } from "../../island-of-settlers-shared/src/catalog/building-data/rules";
import { BUILDING_STRUCTURE_HP, RAID_NEARBY_RADIUS } from "../src/shared/balance/military";
import {
  burnsDownWhenFallen, destructibleWalls, isIndestructible, takeDestroyedSiteSalvage
} from "../src/shared/settlement/building-destruction";
import { COMMANDER_LODGE_TYPE_ID, STOREHOUSE_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { createFactionKnowledge } from "../src/shared/settlement/faction-knowledge";
import { createFactionVision } from "../src/shared/settlement/faction-vision";
import { createCivilianThreat } from "../src/shared/settlement/military-civilian-safety";
import {
  OTHER_BUILDING_TIERS, pickRaidSiegeSite, RAID_TARGET_TIERS, raidSiegeSites, URGENT_BUILDING_TIERS
} from "../src/shared/settlement/raid-target-priority";
import { createColonyCounterattacks } from "../src/shared/settlement/settlement-colony-counterattack";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { advanceSeconds, createBalanceSimulation, placeFinished, placeHostileSite } from "../tools/bench/garrison-balance-harness";
import { troops } from "./helpers/military-assault-fixture";

/** BUILDING-DESTRUCTION phase BD1 (docs/plans/plan-review-2026-11-09.md A3, B1, B7, B9-B11). */
const ENEMY = 1;
const WOODCUTTER = 17;
const site = (uid: number, typeId: number, x: number, extra: Partial<SettlementBuilding> = {}) => ({
  access: { x, z: 1 }, construction: 1, depth: 2, input: {}, typeId, uid, width: 2, x, z: 0, ...extra
}) as unknown as SettlementBuilding;

describe("hit points for every building type", () => {
  it("gives every active type walls; the HQ and the harbour are the strongest", () => {
    const types = buildingsWithRules().map(({ entry }) => entry.code);
    for (const typeId of types) expect(BUILDING_STRUCTURE_HP[typeId], `type ${typeId}`).toBeGreaterThan(0);
    const strongest = Math.max(...types.map(typeId => BUILDING_STRUCTURE_HP[typeId]!));
    expect([BUILDING_STRUCTURE_HP[0], BUILDING_STRUCTURE_HP[39]]).toEqual([strongest, strongest]);
    expect([1, 2, 4, 9].map(typeId => BUILDING_STRUCTURE_HP[typeId])).toEqual([10_000, 20_000, 35_000, 50_000]);
  });

  it("gives a construction site a quarter of its type's walls", () => {
    expect(destructibleWalls({ construction: 1, typeId: WOODCUTTER })).toEqual({ hp: 6000, maximum: 6000 });
    expect(destructibleWalls({ construction: .4, typeId: WOODCUTTER })).toEqual({ hp: 1500, maximum: 1500 });
  });

  it("never makes the player's HQ, landing harbour or roads destroyable; an enemy HQ is", () => {
    expect(isIndestructible(site(1, 0, 0))).toBe(true);
    expect(isIndestructible(site(2, 0, 0, { militaryFaction: ENEMY }))).toBe(false);
    expect(isIndestructible(site(3, 39, 0, { colonyHome: true }))).toBe(true);
    expect(isIndestructible(site(4, 39, 0))).toBe(false);
    expect(isIndestructible(site(5, WOODCUTTER, 0, { vergeSite: {} as never }))).toBe(true);
  });

  it("burns forts down over time and removes other buildings on their fall", () => {
    expect(burnsDownWhenFallen(site(1, 4, 0))).toBe(true);
    expect(burnsDownWhenFallen(site(2, WOODCUTTER, 0))).toBe(false);
    expect(burnsDownWhenFallen(site(3, 4, 0, { construction: .5 }))).toBe(false);
  });

  it("keeps a quarter of a destroyed site's delivered materials, rounded down per ware", () => {
    const destroyed = { constructionConsumed: { planks: 4, stone: 3 }, input: { planks: 3, stone: 0 } };
    expect(takeDestroyedSiteSalvage(destroyed)).toEqual({ planks: 1 });
    expect(destroyed).toEqual({ constructionConsumed: undefined, input: {} });
  });
});

describe("merged target priority (owner Q-BD1)", () => {
  const buildings = [
    site(1, 0, -40), site(2, WOODCUTTER, 2), site(3, WOODCUTTER, 4, { construction: .3 }),
    site(4, STOREHOUSE_TYPE_ID, 6), site(5, COMMANDER_LODGE_TYPE_ID, 60), site(6, 1, 90),
    site(7, WOODCUTTER, 8, { militaryFaction: ENEMY }), site(8, 39, 10, { colonyHome: true })
  ];
  const sources = { buildings, doors: new Map(), holdsSoldiers: (uid: number) => uid === 4 };

  it("ranks garrison, then support and reserve holders, then every other building", () => {
    expect(raidSiegeSites(sources).map(entry => [entry.site.uid, entry.tier])).toEqual([
      [2, RAID_TARGET_TIERS.otherBuilding], [3, RAID_TARGET_TIERS.otherBuilding],
      [4, RAID_TARGET_TIERS.supportBuilding], [5, RAID_TARGET_TIERS.supportBuilding],
      [6, RAID_TARGET_TIERS.garrisonBuilding]
    ]);
  });

  it("picks the most urgent tier first, nearest within it, and other buildings only on their own turn", () => {
    const sites = raidSiegeSites(sources), from = { x: 0, z: 0 };
    expect(pickRaidSiegeSite(sites, from)?.uid).toBe(6);
    expect(pickRaidSiegeSite(sites, from, URGENT_BUILDING_TIERS)?.uid).toBe(6);
    expect(pickRaidSiegeSite(sites.filter(entry => entry.site.uid !== 6), from, URGENT_BUILDING_TIERS)?.uid)
      .toBe(4);
    expect(pickRaidSiegeSite(sites, from, OTHER_BUILDING_TIERS)?.uid).toBe(2);
  });

  it("never picks a building the raiders do not know (A13)", () => {
    const sites = raidSiegeSites({ ...sources, knows: entry => entry.uid === 3 });
    expect(pickRaidSiegeSite(sites, { x: 0, z: 0 })?.uid).toBe(3);
    expect(pickRaidSiegeSite(raidSiegeSites({ ...sources, knows: () => false }), { x: 0, z: 0 })).toBeUndefined();
  });

  it("drops a fallen building from the list at once", () => {
    const doors = new Map([[2, { building: 2, faction: 0, hp: 0, maximum: 200,
      structure: { fallen: 0, hp: 0, maximum: 6000 } }]]);
    expect(raidSiegeSites({ ...sources, doors }).map(entry => entry.site.uid)).not.toContain(2);
  });
});

/** One idle raider at `raiderX` beside the player's HQ (x -60); returns the siege orders it was given. */
const raidOn = (buildings: SettlementBuilding[], raiderX: number, knows = true) => {
  const actors = [{ path: [], pathIndex: 0, phase: "militaryField", uid: 1, visible: true, x: raiderX, y: 0,
    z: 0 } as unknown as SettlementActor];
  const soldiers: SettlementSoldier[] = [{ actor: 1, building: -3, rank: 0, stationed: false,
    combat: { cooldown: 0, faction: ENEMY, hp: 100, type: "heavy" } }];
  const combat = { atDoor: () => false, civilianInReach: () => false, commandOpponent: vi.fn(() => true),
    doors: () => [], rejoinGarrison: () => true, siegeOpponent: vi.fn(() => true), withdrawOpponent: () => true };
  const factionKnowledge = { alerted: () => false, knows: () => true, knowsBuilding: () => knows };
  const context = { actors, buildings: [site(90, 0, -60), ...buildings], factionKnowledge, options: { world: {} } } as
    unknown as SettlementContext;
  const attacks = createColonyCounterattacks(context, { combat, soldiers: () => soldiers, troopType: () => "heavy" } as
    never);
  attacks.restore({ landTime: 1e9, raiders: [1], shipTime: 1e9 });
  attacks.update(.05, "medium", true);
  return combat.siegeOpponent;
};

describe("raiders and other buildings (tier 5)", () => {
  it("besiege the nearest known other building once at the base with no civilian in reach", () => {
    expect(raidOn([site(10, WOODCUTTER, -50), site(11, WOODCUTTER, -20)], -58)).toHaveBeenCalledWith([1], 10, ENEMY);
  });

  it("leave a building they do not know alone", () => {
    expect(raidOn([site(10, WOODCUTTER, -50)], -58, false)).not.toHaveBeenCalled();
  });
});

describe("faction knowledge of buildings", () => {
  it("remembers an enemy building once seen, saves it, and forgets it when removed", () => {
    const house = { access: { x: 5, z: 6 }, militaryFaction: 0, typeId: WOODCUTTER, uid: 40, x: 5, z: 5 };
    const scout = { job: "Soldier", phase: "militaryField", uid: 9, visible: true, x: 40, z: 5 } as SettlementActor;
    const soldier = { actor: 9, building: -3, combat: { cooldown: 0, faction: ENEMY, hp: 100, type: "heavy" },
      rank: 0, stationed: false } as SettlementSoldier;
    const vision = createFactionVision(64, 64);
    const island = { actors: [scout], buildings: [], military: { soldierOf: (uid: number) =>
      uid === 9 ? soldier : undefined } };
    let tick = 0;
    const sources = { buildings: () => [house], now: () => tick, sees: () => vision.sees, units: () => [],
      vision: () => vision };
    const knowledge = createFactionKnowledge(sources);
    const step = (x: number) => { scout.x = x; vision.update(island); knowledge.observe(); tick++; };
    step(40);
    expect(knowledge.knowsBuilding(ENEMY, house)).toBe(false);
    step(8);
    expect(knowledge.knowsBuilding(ENEMY, house)).toBe(true);
    step(50);
    expect(knowledge.knowsBuilding(ENEMY, house)).toBe(true);
    const saved = knowledge.save();
    expect(saved.sites?.map(entry => entry.slice(0, 2))).toEqual([[ENEMY, 40]]);
    const restored = createFactionKnowledge(sources);
    restored.restore(saved);
    expect(restored.knowsBuilding(ENEMY, house)).toBe(true);
    restored.forgetBuilding(40);
    expect(restored.knowsBuilding(ENEMY, house)).toBe(false);
  });
});

describe("refuge choice (plan review B11)", () => {
  it("excludes a storage under siege or with its walls down", () => {
    const store = site(4, STOREHOUSE_TYPE_ID, 0);
    let present = false;
    const { beginTick, threat } = createCivilianThreat({ besieged: uid => uid === 4, enemyWithin: () => false,
      hostilePresent: () => present, nearestEnemy: () => undefined, standing: () => true });
    beginTick();
    expect(threat.unsafeRefuge(store)).toBe(false);
    present = true; beginTick();
    expect(threat.unsafeRefuge(store)).toBe(true);
    expect(threat.unsafeRefuge(site(5, STOREHOUSE_TYPE_ID, 0))).toBe(false);
    const fallen = createCivilianThreat({ besieged: () => false, enemyWithin: () => false,
      hostilePresent: () => false, nearestEnemy: () => undefined, standing: () => false });
    fallen.beginTick();
    expect(fallen.threat.unsafeRefuge(store)).toBe(true);
  });
});

/** A flat island with a finished Woodcutter and a strong computer group next to it. */
const raidedWoodcutter = (construction = 1) => {
  const simulation = createBalanceSimulation(64, 9, { x: 12.5, z: 12.5 });
  const target = placeFinished(simulation, WOODCUTTER, 30, 26);
  target.construction = construction;
  const ids = Array.from({ length: 15 }, (_, index) => simulation.spawnMilitaryOpponent(
    { x: 36 + index % 3, z: 34 + Math.floor(index / 3) }, "heavy", 2, ENEMY)) as number[];
  expect(ids.every(id => id !== null)).toBe(true);
  return { ids, simulation, target };
};
const wallsOf = (simulation: ReturnType<typeof createBalanceSimulation>, uid: number) =>
  simulation.militaryDoors().find(door => door.building === uid)?.structure;
const present = (simulation: ReturnType<typeof createBalanceSimulation>, uid: number) =>
  simulation.buildings().some(building => building.uid === uid);

describe("destroying a civilian building", () => {
  it("takes its type's walls on the first assault and leaves on the fall tick", () => {
    const { ids, simulation, target } = raidedWoodcutter();
    expect(wallsOf(simulation, target.uid)).toBeUndefined();
    expect(simulation.siegeMilitaryOpponent(ids, target.uid, ENEMY)).toBe(true);
    expect(wallsOf(simulation, target.uid)).toEqual({ hp: 6000, maximum: 6000 });
    expect(target.militaryFaction).toBeUndefined();
    let fallTick: number | undefined;
    for (let tick = 0; tick < 20 * 240 && present(simulation, target.uid); tick++) {
      simulation.update(.05);
      if (fallTick === undefined && wallsOf(simulation, target.uid)?.hp === 0) fallTick = simulation.gameTick();
    }
    expect(fallTick).toBeDefined();
    expect(present(simulation, target.uid)).toBe(false);
    expect(simulation.gameTick() - fallTick!).toBeLessThanOrEqual(1);
  }, 120_000);

  it("saves and loads mid-siege with the walls and the raiders' knowledge intact", () => {
    const { ids, simulation, target } = raidedWoodcutter();
    simulation.siegeMilitaryOpponent(ids, target.uid, ENEMY);
    advanceSeconds(simulation, 6);
    const saved = JSON.stringify(simulation.saveState());
    const resume = () => {
      expect(simulation.loadState(JSON.parse(saved))).toEqual({ ok: true });
      advanceSeconds(simulation, 4);
      return JSON.stringify(simulation.saveState());
    };
    expect(JSON.parse(saved).military.combat.doors.some((door: { building: number }) => door.building === target.uid))
      .toBe(true);
    expect(resume()).toBe(resume());
  }, 120_000);

  it("destroys a construction site; its ruin holds only the salvage share of what was delivered (BD2)", () => {
    const { ids, simulation, target } = raidedWoodcutter(.2);
    Object.assign(target, { constructionConsumed: { planks: 4 }, input: { planks: 8 }, required: {} });
    const pool = () => simulation.saveState().storagePools.pools[0]!.available.planks ?? 0;
    const before = pool();
    expect(simulation.siegeMilitaryOpponent(ids, target.uid, ENEMY)).toBe(true);
    expect(wallsOf(simulation, target.uid)?.maximum).toBe(1500);
    for (let second = 0; second < 120 && present(simulation, target.uid); second++) advanceSeconds(simulation, 1);
    expect(present(simulation, target.uid)).toBe(false);
    expect(pool()).toBe(before);
    expect(simulation.ruins().find(ruin => ruin.uid === target.uid)?.salvage).toEqual({ planks: 3 });
  }, 120_000);
});

describe("explicit player orders keep their building target (owner Q-BD8)", () => {
  it("besieges the ordered enemy building, not a more urgent nearer one", () => {
    const simulation = createBalanceSimulation(64, 4);
    const near = placeHostileSite(simulation, 4, 30, 30), far = placeHostileSite(simulation, 1, 50, 50);
    expect(simulation.registerMilitaryGarrison(near.uid, [], ENEMY, 200)).toBe(true);
    expect(simulation.registerMilitaryGarrison(far.uid, [], ENEMY, 200)).toBe(true);
    expect(Math.hypot(near.x - far.x, near.z - far.z)).toBeGreaterThan(RAID_NEARBY_RADIUS);
    simulation.receiveTroops(troops("heavy", 3));
    const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
    simulation.callOutMilitary(["heavy"], { x: 24, z: 24 });
    advanceSeconds(simulation, 30);
    expect(simulation.siegeMilitary(ids, far.uid)).toBe(true);
    advanceSeconds(simulation, 10);
    const sieges = simulation.militarySoldiers().map(soldier => soldier.combat?.siege);
    expect(sieges.every(uid => uid === far.uid)).toBe(true);
  }, 120_000);
});
