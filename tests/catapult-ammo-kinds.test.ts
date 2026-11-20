import { describe, expect, it } from "vitest";

import {
  catapultAmmoProfile, catapultGroundGoods, setCatapultAmmo
} from "../src/shared/settlement/catapult-ammo-kinds";
import {
  CATAPULT, catapultBoulderFlight, fireCatapultTowers, sweepCatapultBoulder
} from "../src/shared/settlement/military-catapult";
import {
  catapultRackKinds, catapultReservedKind, placeCatapultRackStone, releaseReservedStone, reserveRackStone
} from "../src/shared/settlement/military-catapult-ammo";
import { GRANITE_FRAGMENTS } from "../src/shared/settlement/military-catapult-impact";
import {
  advanceCatapultResupply, CATAPULT_SUPPLY_SECONDS, type CatapultSupply, type CatapultSupplyActions,
  catapultSupplyError, depositCatapultGroundStone, dropCatapultStone
} from "../src/shared/settlement/military-catapult-resupply";
import type { MilitaryArrow } from "../src/shared/settlement/military-projectiles";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { validateMilitarySave } from "../src/shared/settlement/settlement-military-state";
import { militarySupplyDemand } from "../src/shared/settlement/settlement-military-supplies";
import { validateSavedBuildings } from "../src/shared/settlement/settlement-save-buildings";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { cancelQueuedAmmoTransfers } from "../src/shared/settlement/settlement-transfer-orders";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { storageDispatchLimit } from "../src/shared/settlement/storage-capacity";
import { createRandom } from "../src/shared/world/rng";
import { huntingWorld } from "./helpers/hunting-world";

const supplySite = (ground = 0) => ({ uid: 1, catapultSupply: { ground } as CatapultSupply,
  input: {} as Record<string, number>, incoming: {} as Record<string, number> }) as {
  catapultCycle?: SettlementBuilding["catapultCycle"]; catapultRackKinds?: SettlementBuilding["catapultRackKinds"];
  catapultSupply: CatapultSupply; incoming: Record<string, number>; input: Record<string, number>; uid: number;
};
const porterActions = (): CatapultSupplyActions => ({
  choosePorter: () => 2, enterPhase: () => {}, finish: () => {}, isAvailable: () => true, walk: () => true
});
/** One complete pile-to-rack trip with an always-arriving porter. */
const haulOne = (site: ReturnType<typeof supplySite>) => {
  const actions = porterActions(), step = (dt = .05) => advanceCatapultResupply(site, dt, false, actions);
  step(); step(); step(CATAPULT_SUPPLY_SECONDS.pickup);
  step(); step(CATAPULT_SUPPLY_SECONDS["stairs-up"]); step();
  step(CATAPULT_SUPPLY_SECONDS.place); step(); step(CATAPULT_SUPPLY_SECONDS["stairs-down"]);
};
const savedTower = () => ({
  uid: 1, typeId: 16, x: 10, y: 0, z: 10, width: 5, depth: 5, rotation: 0,
  construction: 1, working: false, selected: false, cycle: 0, door: 0, hasDoor: true, status: "",
  access: { x: 10, z: 13 }, workerApproach: { x: 10, z: 12 }, doorThreshold: { x: 10, z: 12 },
  accepts: {}, input: { stone: 1, basalt: 1 } as Record<string, number>, incoming: { limestone: 2 },
  inventory: {}, output: {}, required: {}
} as Record<string, unknown>);
const validate = (building: unknown) => validateSavedBuildings([building],
  { cellsX: 40, cellsZ: 40 } as SettlementContext["options"]["world"], new Set(), 0);

describe("Catapult ammunition kinds (CAT-1)", () => {
  it("keeps the default stone tower's demand, pile and rack shape unchanged", () => {
    const tower = { typeId: 16, construction: 1, input: { stone: 1 }, incoming: { stone: 2 } } as unknown as
      SettlementBuilding;
    expect(militarySupplyDemand(tower, [], true, "beer")).toEqual({ coins: 0, drink: 0, drinkWare: "beer", stone: 3 });
    const site = supplySite(1);
    expect(depositCatapultGroundStone(site, 2)).toBe(2);
    haulOne(site);
    expect(site.catapultSupply).toEqual({ ground: 2 });
    expect(site.input).toEqual({ stone: 1 });
    expect(site.catapultRackKinds).toBeUndefined();
  });

  it("requests the chosen kind after a switch while counting every kind against capacity", () => {
    const tower = { typeId: 16, construction: 1, militaryFaction: 0, input: { stone: 1 },
      incoming: { stone: 1 } } as unknown as SettlementBuilding;
    expect(setCatapultAmmo(tower, "basalt")).toBe(true);
    expect(tower.catapultAmmo).toBe("basalt");
    expect(militarySupplyDemand(tower, [], true, "beer")).toMatchObject({ stone: 4, stoneWare: "basalt" });
    const context = { buildings: [tower], military: { buildingStanding: () => true } } as unknown as SettlementContext;
    const source = { uid: 9, typeId: 0 } as SettlementBuilding;
    expect(storageDispatchLimit(context, source, tower, "basalt", 10)).toBe(4);
    expect(storageDispatchLimit(context, source, tower, "stone", 10)).toBe(0);
    expect(setCatapultAmmo(tower, "stone")).toBe(true);
    expect(tower.catapultAmmo).toBeUndefined();
  });

  it("accepts a kind on a construction site and cancels only the queued old-kind orders", () => {
    const site = { typeId: 16, construction: .5, militaryFaction: 0 } as NonNullable<
      Parameters<typeof setCatapultAmmo>[0]
    >;
    expect(setCatapultAmmo(site, "marble")).toBe(true);
    expect(site.catapultAmmo).toBe("marble");
    const context = {
      nextTransferId: 3,
      transfers: [
        { id: 1, source: 0, destination: 7, ware: "stone", count: 3 },
        { id: 2, source: 0, destination: 7, ware: "basalt", count: 2 }
      ],
      actors: [{ nextDelivery: { transferId: 1, units: 2 } }]
    } as unknown as Parameters<typeof cancelQueuedAmmoTransfers>[0];
    cancelQueuedAmmoTransfers(context, 7, "marble");
    expect(context.transfers).toEqual([{ id: 1, source: 0, destination: 7, ware: "stone", count: 2 }]);
  });

  it("rejects unknown kinds and towers the player cannot set", () => {
    const tower = () => ({ typeId: 16, construction: 1 }) as { typeId: number; construction: number;
      militaryFaction?: number };
    for (const kind of ["coins", "", undefined, 3, "Stone"]) expect(setCatapultAmmo(tower(), kind)).toBe(false);
    expect(setCatapultAmmo(undefined, "basalt")).toBe(false);
    expect(setCatapultAmmo({ ...tower(), typeId: 4 }, "basalt")).toBe(false);
    expect(setCatapultAmmo({ ...tower(), construction: .5 }, "basalt")).toBe(true);
    expect(setCatapultAmmo({ ...tower(), militaryFaction: 1 }, "basalt")).toBe(false);
  });

  it("hauls and fires the stock that was there before a switch first (FIFO)", () => {
    const site = supplySite(0);
    depositCatapultGroundStone(site, 1);
    depositCatapultGroundStone(site, 2, "marble");
    expect(site.catapultSupply.groundKinds).toEqual(["stone", "marble", "marble"]);
    haulOne(site); haulOne(site);
    expect(site.input).toEqual({ stone: 1, marble: 1 });
    expect(site.catapultSupply.groundKinds).toEqual(["marble"]);
    expect(catapultGroundGoods(site.catapultSupply)).toEqual({ marble: 1 });
    expect(catapultRackKinds(site)).toEqual(["stone", "marble"]);
    site.catapultCycle = { elapsed: 0, operator: 2, phase: "pick", target: 3 };
    expect(reserveRackStone(site)).toBe(true);
    expect(catapultReservedKind(site.catapultCycle)).toBe("stone");
    site.catapultCycle.ammo = "cup";
    expect(releaseReservedStone(site)).toBe(true);
    expect(site.input).toEqual({ stone: 0, marble: 1 });
    expect(reserveRackStone(site)).toBe(true);
    expect(site.catapultCycle.ammoKind).toBe("marble");
  });

  it("keeps a casualty drop's kind and reconciles a stale rack order", () => {
    const site = supplySite(0);
    expect(dropCatapultStone(site, { x: 1, y: 0, z: 1 }, "granite")).toBe(true);
    expect(site.catapultSupply.drops).toEqual([{ kind: "granite", x: 1, y: 0, z: 1 }]);
    placeCatapultRackStone(site, "limestone");
    site.input.limestone = 0; site.input.stone = 1; // Generic stock code changed the counts.
    expect(catapultRackKinds(site)).toEqual(["stone"]);
  });

  it("round-trips the choice and per-slot kinds through save validation and rejects bad kinds", () => {
    const constructionSite = { ...savedTower(), construction: .4, catapultAmmo: "marble",
      input: {}, incoming: {}, catapultSupply: undefined, catapultRackKinds: undefined };
    expect(validate(constructionSite)).toBeNull();
    const building = savedTower();
    building.catapultAmmo = "limestone"; building.catapultRackKinds = ["basalt", "stone"];
    building.catapultSupply = { ground: 2, groundKinds: ["stone", "basalt"],
      drops: [{ kind: "marble", x: 1, y: 0, z: 1 }] };
    building.input = { stone: 1, basalt: 1 }; building.incoming = {};
    const restored = JSON.parse(JSON.stringify(building)) as Record<string, unknown>;
    expect(validate(restored)).toBeNull();
    expect(restored).toEqual(building);
    for (const change of [
      (site: Record<string, unknown>) => { site.catapultAmmo = "coins"; },
      (site: Record<string, unknown>) => { site.catapultAmmo = "stone"; },
      (site: Record<string, unknown>) => { site.catapultRackKinds = ["beer"]; },
      (site: Record<string, unknown>) => { (site.catapultSupply as CatapultSupply).groundKinds = ["stone"]; },
      (site: Record<string, unknown>) => { site.typeId = 4; delete site.catapultSupply; }
    ]) {
      const site = JSON.parse(JSON.stringify(building)) as Record<string, unknown>;
      change(site);
      expect(validate(site)).toBe("Invalid catapult supply or action");
    }
    expect(catapultSupplyError({ ground: 1, porter: { actor: 2, carrying: false, elapsed: 0, kind: "basalt",
      phase: "outbound" } }, 0, 0)).toBe("Invalid catapult porter ammo kind");
  });

  it("saves and restores the choice through a full simulation snapshot", () => {
    const world = huntingWorld(40), roads = createRoadNetwork(world);
    const simulation = createSettlementSimulation({ world, roads, initialSettlers: 12,
      initialStock: { hammer: 1, shovel: 1, stone: 20, planks: 20 } });
    const placed = simulation.placeBuilding(16, 20.5, 10.5);
    expect(placed.ok, placed.reason).toBe(true);
    const tower = placed.building!;
    expect(simulation.setCatapultAmmo(tower.uid, "granite")).toBe(true); // A construction site can pre-set it.
    Object.assign(tower, { construction: 1, required: {}, input: {}, incoming: {} });
    expect(simulation.setCatapultAmmo(tower.uid, "granite")).toBe(true);
    expect(simulation.setCatapultAmmo(simulation.headquarters.uid, "granite")).toBe(false);
    const saved = simulation.saveState();
    const other = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 12 });
    const loaded = other.loadState(saved);
    expect(loaded.ok, loaded.ok ? "" : loaded.reason).toBe(true);
    expect(other.catapultAmmo(tower.uid)).toBe("granite");
  });

  it("splits a granite bundle into five deterministic wide fragments", () => {
    const building = { uid: 1, typeId: 16, x: 4, y: 0, z: 4, width: 2, depth: 2, rotation: 0, construction: 1,
      input: { granite: 1 }, incoming: {} } as unknown as SettlementBuilding;
    const operator = { actor: 2, building: 1, rank: 0, stationed: true,
      combat: { type: "heavy", hp: 100, faction: 0, cooldown: 0 } } as SettlementSoldier;
    const foe = { ...operator, actor: 3, building: -3, stationed: false,
      combat: { ...operator.combat!, faction: 1 } };
    const target = { uid: 3, x: 10, y: 0, z: 4, visible: true, phase: "militaryField" } as SettlementActor;
    const context = { buildings: [building], options: { world: { cellsX: 16, cellsZ: 16,
      heights: new Float32Array(17 * 17) } } } as unknown as SettlementContext;
    const launched: Omit<MilitaryArrow, "id">[] = [];
    const soldiers = new Map([[2, operator], [3, foe]]);
    for (let tick = 0; tick < 800 && !launched.length; tick += 1)
      fireCatapultTowers(context, soldiers, [target], .05, shot => { launched.push(shot); }, () => true,
        createRandom(9));
    expect(launched).toHaveLength(GRANITE_FRAGMENTS);
    expect(launched.every(shot => shot.boulder?.kind === "granite" && shot.boulder.fragment)).toBe(true);
    expect(new Set(launched.map(shot => `${shot.boulder!.x.toFixed(4)}:${shot.boulder!.z.toFixed(4)}`)).size)
      .toBe(GRANITE_FRAGMENTS);
  });

  it("launches a boulder that carries its kind to the impact and keeps stone values", () => {
    const building = { uid: 1, typeId: 16, x: 4, y: 0, z: 4, width: 2, depth: 2, rotation: 0, construction: 1,
      input: { basalt: 2 }, incoming: {} } as unknown as SettlementBuilding;
    const operator = { actor: 2, building: 1, rank: 0, stationed: true,
      combat: { type: "heavy", hp: 100, faction: 0, cooldown: 0 } } as SettlementSoldier;
    const foe = { ...operator, actor: 3, building: -3, stationed: false, combat: { ...operator.combat!, faction: 1 } };
    const target = { uid: 3, x: 8, y: 0, z: 4, visible: true, phase: "militaryField" } as SettlementActor;
    const context = { buildings: [building], options: { world: { cellsX: 16, cellsZ: 16,
      heights: new Float32Array(17 * 17) } } } as unknown as SettlementContext;
    const launched: Omit<MilitaryArrow, "id">[] = [];
    const soldiers = new Map([[2, operator], [3, foe]]);
    for (let tick = 0; tick < 800 && !launched.length; tick++)
      fireCatapultTowers(context, soldiers, [target], .05, shot => { launched.push(shot); });
    expect(launched).toHaveLength(1);
    expect(launched[0]!.boulder?.kind).toBe("basalt");
    expect(building.input.basalt).toBe(1);
    expect(catapultAmmoProfile("basalt")).toMatchObject({ impactRadius: 1.5, range: .8 });
    expect(catapultAmmoProfile("limestone")).toMatchObject({ damage: .6, range: 1.3 });
    expect(catapultAmmoProfile("marble")).toMatchObject({ flightTime: .65, impactRadius: .35 });
    expect(catapultAmmoProfile("granite")).toEqual(catapultAmmoProfile("stone"));
    expect(catapultBoulderFlight("stone")).toBe(CATAPULT.flight);
    expect(catapultBoulderFlight("marble")).toBe(CATAPULT.flight * .65);
    const shot = { ...launched[0]!, id: 1, boulder: { ...launched[0]!.boulder! } };
    expect(sweepCatapultBoulder(shot, CATAPULT.flight).stopped).toBe(true);
    const boulder: { fragment?: boolean; kind: string; restAge?: number; target: number; x: number; y: number; z: number } =
      { kind: "basalt", target: 3, x: 8, y: 0, z: 4 };
    const saved = { randomState: 0, soldiers: [], targets: [], coinsAllowed: [], recruitTimers: [], trainTimers: [],
      combat: { doors: [], nextArrow: 1, arrows: [{ id: 0, shooter: 2, building: 99, faction: 0, rank: 0,
        x: 4, y: 2, z: 4, vx: 1, vy: 1, vz: 1, age: .5, boulder }] } };
    expect(validateMilitarySave(saved, [], [])).toBeNull();
    boulder.fragment = true;
    expect(validateMilitarySave(saved, [], [])).toBeNull();
    boulder.restAge = 2;
    expect(validateMilitarySave(saved, [], [])).toBeNull();
    for (const kind of ["coins", "stone"]) {
      boulder.kind = kind;
      expect(validateMilitarySave(saved, [], [])).toBe("Invalid catapult boulder");
    }
  });
});
