import { describe, expect, it, vi } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  ACADEMY_STRUCTURE_HP, COMMANDER_LODGE_STRUCTURE_HP, RAID_NEARBY_RADIUS
} from "../src/shared/balance/military";
import { COMMANDER_LODGE_TYPE_ID, TAVERN_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import type { MilitaryDoor } from "../src/shared/settlement/military-combat-rules";
import { fortifyPlayerSite, isPlayerFortCandidate } from "../src/shared/settlement/military-siege-sites";
import {
  pickRaidSiegeSite, RAID_TARGET_TIERS, raidSiegeSites
} from "../src/shared/settlement/raid-target-priority";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createColonyCounterattacks } from "../src/shared/settlement/settlement-colony-counterattack";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
import { advance, type AssaultSimulation, ENEMY, siteDoor, standing } from "./helpers/military-assault-fixture";

/**
 * Raid target priority (owner 2026-11-09): enemy soldiers near the raid, then buildings that hold
 * soldiers, then the Military Academy and the Commander's Lodge (only while no garrison building
 * stands within the raids' nearby radius), then civilians. Other buildings are not attackable yet.
 */
const site = (uid: number, typeId: number, x: number, z = 0) => ({ access: { x, z: z + 1 }, construction: 1,
  depth: 2, typeId, uid, width: 2, x, z }) as unknown as SettlementBuilding;
const NO_DOORS: ReadonlyMap<number, MilitaryDoor> = new Map();

describe("raid target priority helper", () => {
  it("documents the owner order and names one nearby radius", () => {
    expect(RAID_TARGET_TIERS).toEqual({ civilian: 4, garrisonBuilding: 2, otherBuilding: 5, soldier: 1,
      supportBuilding: 3 });
    expect(RAID_NEARBY_RADIUS).toBe(18);
    expect(ACADEMY_STRUCTURE_HP).toBe(20_000);
    expect(COMMANDER_LODGE_STRUCTURE_HP).toBe(15_000);
  });

  it("leaves an Academy or a Lodge alone while a garrison building stands nearby", () => {
    const barracks = site(1, 1, 0), lodge = site(2, COMMANDER_LODGE_TYPE_ID, 10), academy = site(3, TAVERN_TYPE_ID, 40);
    const buildings = [barracks, lodge, academy];
    expect(raidSiegeSites({ buildings, doors: NO_DOORS }).map(entry => [entry.site.uid, entry.tier])).toEqual([
      [1, RAID_TARGET_TIERS.garrisonBuilding], [3, RAID_TARGET_TIERS.supportBuilding]
    ]);
    // A fallen garrison building no longer shields the Lodge, and is no target itself (BD1: destroyed at HP 0).
    const fallen = new Map([[1, { building: 1, faction: 0, hp: 0, maximum: 200,
      structure: { fallen: 0, hp: 0, maximum: 10_000 } }]]);
    expect(raidSiegeSites({ buildings, doors: fallen }).map(entry => entry.site.uid)).toEqual([2, 3]);
  });

  it("prefers a building that holds soldiers over a nearer Academy or Lodge", () => {
    const sites = [{ known: true, site: site(5, TAVERN_TYPE_ID, 2), tier: 3 },
      { known: true, site: site(6, 4, 50), tier: 2 }];
    expect(pickRaidSiegeSite(sites, { x: 0, z: 0 })?.uid).toBe(6);
    expect(pickRaidSiegeSite(sites.slice(0, 1), { x: 0, z: 0 })?.uid).toBe(5);
  });

  it("fortifies only an unshielded Academy or Lodge, with its own wall HP", () => {
    for (const [typeId, hp] of [[TAVERN_TYPE_ID, 20_000], [COMMANDER_LODGE_TYPE_ID, 15_000]] as const) {
      const target = site(7, typeId, 0), guard = site(8, 2, RAID_NEARBY_RADIUS - 1);
      const doors = new Map<number, MilitaryDoor>();
      expect(isPlayerFortCandidate(target, doors, [target, guard])).toBe(false);
      expect(fortifyPlayerSite(target, doors, [target, guard])).toBeUndefined();
      expect(target.militaryFaction).toBeUndefined();
      const far = site(8, 2, RAID_NEARBY_RADIUS + 1);
      expect(isPlayerFortCandidate(target, doors, [target, far])).toBe(true);
      expect(fortifyPlayerSite(target, doors, [target, far])?.structure).toEqual({ hp, maximum: hp });
    }
  });
});

const RAIDER = 1;
const raidOn = (buildings: SettlementBuilding[], raiderX = 0) => {
  const actors = [{ path: [], pathIndex: 0, phase: "militaryField", uid: RAIDER, visible: true, x: raiderX, y: 0,
    z: 0 } as unknown as SettlementActor];
  const soldiers: SettlementSoldier[] = [{ actor: RAIDER, building: -3, rank: 0, stationed: false,
    combat: { cooldown: 0, faction: 1, hp: 100, type: "heavy" } }];
  const combat = { atDoor: () => false, civilianInReach: () => false, commandOpponent: vi.fn(() => true),
    doors: () => [], rejoinGarrison: () => true, siegeOpponent: vi.fn(() => true), withdrawOpponent: () => true };
  const context = { actors, buildings: [site(90, 0, -60), ...buildings], options: { world: {} } } as unknown as
    SettlementContext;
  const attacks = createColonyCounterattacks(context,
    { combat, soldiers: () => soldiers, troopType: () => "heavy" } as never);
  attacks.restore({ landTime: 1e9, raiders: [RAIDER], shipTime: 1e9 });
  attacks.update(.05, "medium", true);
  return combat.siegeOpponent;
};

describe("counterattack raiders follow the priority", () => {
  it("besieges the garrison building first, then an exposed Lodge", () => {
    expect(raidOn([site(10, COMMANDER_LODGE_TYPE_ID, 5), site(11, 4, 40)])).toHaveBeenCalledWith([RAIDER], 11, 1);
    expect(raidOn([site(10, COMMANDER_LODGE_TYPE_ID, 5)])).toHaveBeenCalledWith([RAIDER], 10, 1);
  });

  it("never sends raiders at a Lodge shielded by a nearby garrison building", () => {
    const siege = raidOn([site(10, COMMANDER_LODGE_TYPE_ID, 5), site(11, 1, 12)]);
    expect(siege).toHaveBeenCalledWith([RAIDER], 11, 1);
    expect(siege).not.toHaveBeenCalledWith([RAIDER], 10, 1);
  });
});

const SIZE = 64;
const flatWorld = () => ({ blocking: new Uint8Array(SIZE ** 2), buildClass: new Uint8Array(SIZE ** 2).fill(BUILD.large),
  cellsX: SIZE, cellsZ: SIZE, heights: new Float32Array((SIZE + 1) ** 2), mineZone: new Uint16Array(SIZE ** 2),
  mineZones: [], oreAmount: new Uint8Array(SIZE ** 2), props: { count: 0, scale: new Float32Array(),
    types: new Uint8Array(), x: new Float32Array(), z: new Float32Array() }, seaLevel: -1, seed: 9,
  start: { x: 16.5, z: 14.5 }, walkCost: new Uint8Array(SIZE ** 2).fill(10) }) as unknown as WorldData;

/** A flat island with a finished, road-connected building of `typeId`. */
const islandWith = (typeId: number, stock: Record<string, number>) => {
  let simulation: AssaultSimulation | undefined;
  const world = flatWorld();
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  const sim = createSettlementSimulation({ canWorkerEnterPlot: () => true, developmentAllowed: true,
    initialSettlers: 20, initialStock: { planks: 80, stone: 80, ...stock }, playerLevel: () => 23, roads, world });
  simulation = sim;
  const place = (id: number, x: number, z: number) => {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    const placed = sim.placeBuilding(id, x + width % 2 / 2, z + depth % 2 / 2);
    if (!placed.ok || !placed.building) throw new Error(placed.reason);
    Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
    roads.addRoad(sim.headquarters.access, placed.building.access);
    return placed.building;
  };
  return { place, sim, target: place(typeId, 30, 26) };
};

/** A strong computer group attack-moving onto `access` from the open field. */
const assault = (sim: AssaultSimulation, access: { x: number; z: number }) => {
  const ids = Array.from({ length: 15 }, (_, index) =>
    sim.spawnMilitaryOpponent({ x: 44 + index % 3, z: 44 + Math.floor(index / 3) }, "heavy", 2, ENEMY));
  expect(ids.every(id => id !== null)).toBe(true);
  expect(sim.commandMilitaryOpponent(ids as number[], access, ENEMY)).toBe(true);
};

const runUntilGone = (sim: AssaultSimulation, uid: number, limit = 600) => {
  for (let second = 0; second < limit && standing(sim, uid); second++) advance(sim, 1);
};

describe("destroying an Academy or a Lodge", () => {
  it("keeps a Lodge with a garrison building nearby out of the assault", () => {
    const { place, sim, target } = islandWith(COMMANDER_LODGE_TYPE_ID, {});
    place(1, 36, 26);
    assault(sim, target.access);
    advance(sim, 90);
    expect(siteDoor(sim, target.uid)).toBeUndefined();
    expect(standing(sim, target.uid)).toBe(true);
  }, 120_000);

  it("evicts the commander wounded but alive, then rehomes him in a rebuilt Lodge", () => {
    const { place, sim, target } = islandWith(COMMANDER_LODGE_TYPE_ID,
      { beer: 40, coins: 40, shield: 6, sword: 6, wine: 40 });
    expect(sim.recruitCommander(target.uid).ok).toBe(true);
    const id = sim.commanderState()!.id;
    assault(sim, target.access);
    runUntilGone(sim, target.uid);
    expect(standing(sim, target.uid)).toBe(false);
    const commander = sim.militarySoldiers().find(soldier => soldier.commanderId === id);
    expect(commander?.combat?.hp).toBeGreaterThanOrEqual(1);
    expect(sim.commanderState()).toMatchObject({ homeLodgeUid: target.uid, id, location: "lodge" });
    const body = sim.frames().find(actor => actor.uid === commander!.actor);
    expect(body?.visible).toBe(false);
    const saved = JSON.stringify(sim.saveState());
    const resume = () => {
      expect(sim.loadState(JSON.parse(saved))).toEqual({ ok: true });
      advance(sim, 5);
      return JSON.stringify(sim.saveState());
    };
    expect(resume()).toBe(resume());
    const rebuilt = place(COMMANDER_LODGE_TYPE_ID, 14, 40);
    advance(sim, 1);
    expect(sim.commanderState()).toMatchObject({ homeLodgeUid: rebuilt.uid, id, location: "lodge" });
  }, 240_000);

  it("cancels the Academy's training batch and returns the equipment it took", () => {
    const kit = { armor: 2, axe: 2, beer: 2 };
    const { sim, target } = islandWith(TAVERN_TYPE_ID, kit);
    advance(sim, 2);
    expect(sim.orderTavernRecruits(target.uid, "heavy", 1).ok).toBe(true);
    let saved = sim.saveState();
    for (let second = 0; second < 300 && saved.tavern?.batches[0]?.[1].stage !== "train"; second++) {
      advance(sim, .5);
      saved = sim.saveState();
    }
    expect(saved.tavern?.batches[0]?.[1].stage).toBe("train");
    // Hold the recruit in training while the walls come down.
    saved.tavern!.batches[0]![1].timer = 1e6;
    expect(sim.loadState(saved)).toEqual({ ok: true });
    assault(sim, target.access);
    runUntilGone(sim, target.uid);
    expect(standing(sim, target.uid)).toBe(false);
    expect(sim.saveState().tavern?.batches ?? []).toEqual([]);
    for (const [ware, count] of Object.entries(kit)) expect(sim.resourceTotal(ware), ware).toBe(count);
  }, 240_000);
});
