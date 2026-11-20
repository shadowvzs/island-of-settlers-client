import { type TalentModifiers } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { type ColonyArrival, colonySettlementOptions } from "../src/app/settlement/colony-boot";
import { createTreeGrowth, getGrowthState } from "../src/render-common/growth/tree-growth";
import { cartCapacityFor } from "../src/render-common/logistics/handcart-rules";
import { BUILDING_LEVEL_STEPS } from "../src/shared/balance/building-levels";
import { COLONY_ORE_SHIP_MS } from "../src/shared/balance/colonies";
import { PRODUCTION_SPEED_FACTOR } from "../src/shared/balance/economy";
import { talentModifiers, type TalentRanks } from "../src/shared/progression/talents";
import { adventureRewardGoods } from "../src/shared/settlement/adventure-rules";
import { colonyOreShipMs } from "../src/shared/settlement/archipelago";
import { REPLAY_COMMANDS } from "../src/shared/settlement/settlement-commands";
import { createSettlementFieldCycles } from "../src/shared/settlement/settlement-field-cycles";
import { type NavalShip, shipVoyageRate } from "../src/shared/settlement/settlement-naval-fleet";
import {
  carrierSpeedFactor, productionTalentBonus, siegeTalentFactor, soldierBlowTalentFactor
} from "../src/shared/settlement/settlement-talents";
import type { SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import { dockPorterSpeedFactor } from "../src/shared/settlement/ship-cargo-handling";
import { canStoreGoods, islandStorageCapacity } from "../src/shared/settlement/storage-capacity";
import {
  doorBlowDamage, tavernTrainingFactor, workerCycleRate, workshopCycleFactor
} from "../src/shared/settlement/workshop-upgrades";
import { settlementTradePort } from "../src/shared/trade/trade-island";
import { createTradeState } from "../src/shared/trade/trade-ledger";

const talents = (ranks: TalentRanks) => ({ talents: talentModifiers(ranks) });
const upgraded = { workshopUpgrade: { level: 1 as const } };

describe("economy talent hooks", () => {
  it("adds the production talent to the workshop upgrade (and the capstone on colonies only)", () => {
    expect(workshopCycleFactor({ typeId: 35 }, .1)).toBeCloseTo(1.1);
    expect(workshopCycleFactor({ typeId: 35, ...upgraded }, .1)).toBeCloseTo(1.2);
    expect(workshopCycleFactor({ militaryFaction: 2, typeId: 35 }, .1)).toBe(1);
    expect(workshopCycleFactor({ typeId: 0 }, .1)).toBe(1);
    const ranks = { colonyProduction: 5, productionSpeed: 5 };
    expect(productionTalentBonus({ ...talents(ranks), options: { homeBuilding: 0 } }, 35)).toBeCloseTo(.1);
    expect(productionTalentBonus({ ...talents(ranks), options: { homeBuilding: 39 } }, 35)).toBeCloseTo(.35);
  });
  it("speeds only the hunter and the fishery with the hunter & fisher talent", () => {
    const context = talents({ hunterFisherSpeed: 5, productionSpeed: 5 });
    expect(productionTalentBonus(context, 22)).toBeCloseTo(.35);
    expect(productionTalentBonus(context, 18)).toBeCloseTo(.35);
    expect(productionTalentBonus(context, 35)).toBeCloseTo(.1);
    const hunter = { typeId: 22, uid: 3, worker: 1 } as SettlementBuilding;
    const rate = workerCycleRate({ buildings: [hunter], ...context }, { building: 3, phase: "huntWait", uid: 1 });
    expect(rate).toBeCloseTo(1.35 * PRODUCTION_SPEED_FACTOR);
  });
  it("runs the own worker's in-place work and a builder's hammering faster", () => {
    const building = { typeId: 35, uid: 3, worker: 1 } as SettlementBuilding;
    const context = { buildings: [building], playerNation: "viking" as const,
      ...talents({ constructionSpeed: 5, productionSpeed: 5 }) };
    // Production times are halved (BAL-01): the talent adds to the doubled base rate.
    expect(workerCycleRate(context, { building: 3, phase: "work", uid: 1 })).toBeCloseTo(1.1 * PRODUCTION_SPEED_FACTOR);
    expect(workerCycleRate(context, { building: 3, phase: "outbound", uid: 1 })).toBe(1);
    expect(workerCycleRate(context, { action: "work", building: 3, phase: "builderWork", uid: 9 })).toBeCloseTo(1.15);
    expect(workerCycleRate(context, { action: "walk", building: 3, phase: "builderWork", uid: 9 })).toBe(1);
  });
  it("raises each storage's capacity by the storage talent, added to its upgrade", () => {
    const storage = (typeId: number, extra = {}) => ({ construction: 1, incoming: {}, inventory: { logs: 990 },
      typeId, ...extra }) as unknown as SettlementBuilding;
    expect(islandStorageCapacity([storage(0)], .25).capacity).toBe(1250);
    expect(islandStorageCapacity([storage(0, upgraded)], .25).capacity)
      .toBe(1000 * (1.25 + BUILDING_LEVEL_STEPS.storage));
    expect(canStoreGoods([storage(29)], { logs: 10 })).toBe(false);
    expect(canStoreGoods([storage(0)], { logs: 50 }, .05)).toBe(true);
  });
  it("grows crops (never charcoal) faster with the field growth talent", () => {
    const building = { access: { x: 4, z: 4 }, input: {}, typeId: 37, uid: 1, workerApproach: { x: 4, z: 4 },
      x: 4, z: 4 } as unknown as SettlementBuilding;
    const context = { buildings: [building], occupied: new Uint8Array(256), options: {
      findWorkerPath: (_from: unknown, to: unknown) => [to], roads: { route: () => null },
      world: { blocking: new Uint8Array(256), buildClass: new Uint8Array(256).fill(4), cellsX: 16, cellsZ: 16,
        walkCost: new Uint8Array(256).fill(10) } },
    reservations: new Set(), ...talents({ fieldGrowth: 5 }) } as unknown as SettlementContext;
    const cycles = createSettlementFieldCycles(context);
    const target = { id: 69, kind: "field" as const, x: 5.5, z: 4.5 };
    cycles.complete(building, target);
    cycles.update(95);
    expect(cycles.complete(building, target)).toEqual({ success: false });
    cycles.update(1);
    expect(cycles.complete(building, target)).toEqual({ success: true, ware: "grain" });
  });
  it("keeps a growing tree's growth when the tree growth speed changes", () => {
    const growth = createTreeGrowth([], 1, () => true);
    growth.update(0);
    growth.plant(7, 0);
    growth.update(30);
    const before = [...growth.frame.growing()][0]!;
    growth.setSpeed(1.25);
    growth.update(30);
    expect([...growth.frame.growing()][0]).toEqual(before);
    growth.update(30 + 90 / 1.25 - .01);
    expect(growth.frame.isGrowing(7)).toBe(true);
    growth.update(30 + 90 / 1.25 + .01);
    expect(growth.frame.isGrown(7)).toBe(true);
    expect(getGrowthState(120)).toBeNull();
    const saved = growth.saveState();
    expect(saved.speed).toBe(1.25);
  });
});

describe("logistics talent hooks", () => {
  it("adds the handcart talent's share to a cart load, rounded down", () => {
    expect(cartCapacityFor("stone")).toBe(6);
    expect(cartCapacityFor("stone", .1)).toBe(6);
    expect(cartCapacityFor("stone", .2)).toBe(7);
    expect(cartCapacityFor("stone", .5)).toBe(9);
    expect(cartCapacityFor("pig", .5)).toBe(0);
  });
  it("speeds dock porters with the harbour upgrade plus Shipping", () => {
    expect(dockPorterSpeedFactor(1, .25)).toBeCloseTo(1.35);
  });
  it("shortens trade, supply and colony voyages with Shipping and adventures with their own talent", () => {
    const context = talents({ adventureSailing: 5, shipping: 2 });
    const ship = (extra: Partial<NavalShip>) => extra as NavalShip;
    expect(shipVoyageRate(context, ship({ visitor: { exit: { x: 0, z: 0 }, pickup: [], role: "trade" } })))
      .toBeCloseTo(1 / .9);
    expect(shipVoyageRate(context, ship({ colony: { boxes: 1, expeditionId: 1, exit: { x: 0, z: 0 },
      voyageSeconds: 60 } }))).toBeCloseTo(1 / .9);
    expect(shipVoyageRate(context, ship({ colony: { adventure: true, boxes: 1, expeditionId: 1,
      exit: { x: 0, z: 0 }, voyageSeconds: 60 } }))).toBeCloseTo(1 / .75);
    expect(shipVoyageRate(context, ship({ visitor: { exit: { x: 0, z: 0 }, pickup: [], role: "reward" } })))
      .toBeCloseTo(1 / .75);
  });
  it("shortens the colony resource ship interval at every rank from 0 to 5", () => {
    for (const rank of [0, 1, 2, 3, 4, 5]) {
      const reduction = talentModifiers(rank ? { colonyShipInterval: rank } : {}).colonyShipIntervalReduction;
      expect(reduction).toBeCloseTo(rank * .05);
      expect(colonyOreShipMs(reduction)).toBeCloseTo(COLONY_ORE_SHIP_MS * (1 - rank * .05));
    }
  });
  it("lands extra settlers with a new colony, never above the colony limit and never on adventures", () => {
    const arrival = (crew: number, island: object) =>
      ({ record: { island, landing: { crew } } }) as unknown as ColonyArrival;
    const colony = { ore: "ironOre" }, adventure = { kind: "adventure" };
    expect(colonySettlementOptions(null, arrival(10, colony), 10).initialSettlers).toBe(20);
    expect(colonySettlementOptions(null, arrival(45, colony), 10).initialSettlers).toBe(50);
    expect(colonySettlementOptions(null, arrival(60, colony), 10).initialSettlers).toBe(60);
    expect(colonySettlementOptions(null, arrival(10, adventure), 10).initialSettlers).toBe(10);
  });
  it("adds trade office offer slots", () => {
    const context = { buildings: [], options: { world: { seed: 1 } }, ...talents({ tradeOfferSlot: 3 }) };
    expect(settlementTradePort(context as unknown as SettlementContext, createTradeState()).offerLimit).toBe(8);
  });
  it("journals the talent command for bug replays", () => {
    expect(REPLAY_COMMANDS).toContain("setTalentRanks");
  });
});

describe("military talent hooks", () => {
  const military = (ranks: TalentRanks) => talents(ranks) as { talents: Readonly<TalentModifiers> };
  it("trains recruits faster and strengthens player doors, added to the upgrades", () => {
    expect(tavernTrainingFactor({ typeId: 40, ...upgraded }, .25)).toBeCloseTo(1.35);
    expect(doorBlowDamage(10, 0, { typeId: 1, ...upgraded }, .25))
      .toBeCloseTo(10 / (1.25 + BUILDING_LEVEL_STEPS.door));
    expect(doorBlowDamage(10, 1, { typeId: 1 }, .25)).toBe(10);
  });
  it("raises player soldiers' damage, tower archery and health only", () => {
    const context = military({ soldierStrength: 5, towerArcherDamage: 5 });
    expect(soldierBlowTalentFactor(context, 0, 1, false)).toBeCloseTo(1.15);
    expect(soldierBlowTalentFactor(context, 0, 1, true)).toBeCloseTo(1.4);
    expect(soldierBlowTalentFactor(context, 1, 0, true)).toBeCloseTo(1 / 1.15);
    expect(soldierBlowTalentFactor(context, 1, 2, true)).toBe(1);
  });
  it("adds siege damage to player blows against walls", () => {
    const context = military({ siegeDamage: 5 });
    expect(siegeTalentFactor(context, 0)).toBeCloseTo(1.25);
    expect(siegeTalentFactor(context, 1)).toBe(1);
  });
  it("raises adventure loot per ware", () => {
    const base = adventureRewardGoods({ difficulty: "hard" });
    const boosted = adventureRewardGoods({ difficulty: "hard" }, .25);
    expect(boosted.coins).toBe(Math.round(base.coins * 1.25));
  });
});

describe("added talents (owner 2026-10-20)", () => {
  it("speeds carriers by the carrier speed talent", () => {
    expect(carrierSpeedFactor({})).toBe(1);
    expect(carrierSpeedFactor(talents({ carrierSpeed: 5 }))).toBeCloseTo(1.15);
  });
});
