import { SAWMILL_RECIPES } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import {
  committedWorkerInputs, reservedInputReturns, unusedSawmillInputs
} from "../src/shared/settlement/sawmill-input-returns";
import { unlockedSawmillRecipes } from "../src/shared/settlement/sawmill-recipes";
import { scheduleDeliveries, updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { cancelUnreachableTask } from "../src/shared/settlement/settlement-navigation-cancellation";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type {
  SettlementActor, SettlementBuilding, SettlementContext
} from "../src/shared/settlement/settlement-types";
import {
  cancelWorkshopUpgrade, finishWorkshopUpgrade, requestWorkshopUpgrade, updateWorkshopUpgrade,
  validWorkshopUpgrade, workshopUpgradeCost, workshopUpgradeDemand
} from "../src/shared/settlement/workshop-upgrades";
import { colonyResourcePair, type ColonyResourceTier } from "../src/shared/world/colony-resource-tiers";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const sawmill = (extra: Partial<SettlementBuilding> = {}) => ({
  uid: 1, typeId: 33, construction: 1, input: {}, incoming: {}, output: {}, ...extra
}) as SettlementBuilding;
const actor = (extra: Partial<SettlementActor>) => ({
  uid: 8, job: "Carrier", ware: null, phase: "pickup", ...extra
}) as SettlementActor;
const observation = (actors: SettlementActor[] = []) => ({ actors }) as SettlementContext;

describe("sequential sawmill upgrades and separate material escrow", () => {
  it("unlocks exactly one retained recipe after each fully paid tier, stopping at level five", () => {
    const building = sawmill({ input: { logs: 7, hardwoodLogs: 3 } });
    for (const tier of [1, 2, 3, 4] as ColonyResourceTier[]) {
      // Logs and stone of the unlocked tier, one more of each per level (4/2, 5/3, 6/4, 7/5).
      const pair = colonyResourcePair(tier), cost = { [`${pair.wood}Logs`]: 3 + tier, [pair.stone]: 1 + tier };
      expect(workshopUpgradeCost(building)).toEqual(cost);
      expect(requestWorkshopUpgrade(building)).toBe(true);
      expect(building.workshopUpgrade?.level).toBe(tier - 1);
      expect(unlockedSawmillRecipes(building)).toEqual(SAWMILL_RECIPES.slice(0, tier));
      expect(finishWorkshopUpgrade(building)).toBe(false);
      Object.assign(building.workshopUpgrade!.reserved!, cost);
      expect(validWorkshopUpgrade(building)).toBe(true);
      expect(finishWorkshopUpgrade(building)).toBe(true);
      expect(building.workshopUpgrade).toEqual({ level: tier });
      expect(unlockedSawmillRecipes(building)).toEqual(SAWMILL_RECIPES.slice(0, tier + 1));
      expect(building.input).toEqual({ logs: 7, hardwoodLogs: 3 });
    }
    expect(requestWorkshopUpgrade(building)).toBe(false);
  });
  it("preserves completed levels and production logs while late cancelled deliveries refund only escrow", () => {
    const building = sawmill({ workshopUpgrade: { level: 1 }, input: { cedarLogs: 5, logs: 2 } });
    expect(requestWorkshopUpgrade(building)).toBe(true);
    building.workshopUpgrade!.reserved!.cedarLogs = 1;
    building.workshopUpgrade!.incoming!.limestone = 1; building.incoming.limestone = 1;
    expect(cancelWorkshopUpgrade(building)).toBe(true);
    updateWorkshopUpgrade(building);
    expect(building.output.cedarLogs).toBe(1);
    expect(building.input).toEqual({ cedarLogs: 5, logs: 2 });
    expect(building.workshopUpgrade).toMatchObject({ level: 1, cancelling: true });
    // Mirror the carrier's physical arrival; cancellation remains pending until its promise clears.
    building.workshopUpgrade!.reserved!.limestone = 1;
    building.workshopUpgrade!.incoming!.limestone = 0; building.incoming.limestone = 0;
    updateWorkshopUpgrade(building); updateWorkshopUpgrade(building);
    expect(building.output).toEqual({ cedarLogs: 1, limestone: 1 });
    expect(building.workshopUpgrade).toEqual({ level: 1 });
    expect(unlockedSawmillRecipes(building)).toHaveLength(2);
  });
  it("counts only escrow deliveries as upgrade supply and rejects impossible levels or over-reservations", () => {
    const building = sawmill({ input: { hardwoodLogs: 100, marble: 10 }, incoming: { hardwoodLogs: 2 } });
    requestWorkshopUpgrade(building);
    expect(workshopUpgradeDemand(building)).toEqual({ hardwoodLogs: 4, marble: 2 });
    building.workshopUpgrade!.reserved!.hardwoodLogs = 3;
    building.workshopUpgrade!.incoming!.hardwoodLogs = 2;
    expect(validWorkshopUpgrade(building)).toBe(false);
    expect(validWorkshopUpgrade(sawmill({ typeId: 25, workshopUpgrade: { level: 5 as never } }))).toBe(false);
    expect(validWorkshopUpgrade(sawmill({ workshopUpgrade: { level: 4, requested: true } }))).toBe(false);
  });
  it("finishes a pending request without escrow from its input at the level's own cost", () => {
    const building = sawmill({ workshopUpgrade: { level: 0, requested: true },
      input: { hardwoodLogs: 4, marble: 2, logs: 3 } });
    expect(workshopUpgradeCost(building)).toEqual({ hardwoodLogs: 4, marble: 2 });
    expect(finishWorkshopUpgrade(building)).toBe(true);
    expect(building.input).toEqual({ hardwoodLogs: 0, logs: 3, marble: 0 });
    expect(workshopUpgradeCost(building)).toEqual({ cedarLogs: 5, limestone: 3 });
  });
});

describe("sawmill obsolete-input ownership", () => {
  it("ignores ordinary same-ware output deliveries without poisoning the input reservation count", () => {
    const building = sawmill({ input: { logs: 2 } });
    const ordinary = actor({ delivery: { source: 1, destination: 0, ware: "logs", reserved: true } });
    const inputReturn = actor({ uid: 9, delivery: { source: 1, destination: 0,
      ware: "logs", reserved: true, sourceInput: true } });
    expect(reservedInputReturns(observation([ordinary]), building, "logs")).toBe(0);
    expect(reservedInputReturns(observation([ordinary, inputReturn]), building, "logs")).toBe(1);
  });
  it("protects committed inputs and assigned returns when switching recipes back", () => {
    const building = sawmill({ worker: 7, workshopUpgrade: { level: 1 }, selectedOutput: "hardwoodPlanks",
      input: { logs: 4 } });
    const worker = actor({ uid: 7, job: "Carpenter", productionInputs: ["logs", "logs"] });
    const carrier = actor({ delivery: { source: 1, destination: 0, ware: "logs", sourceInput: true, reserved: true } });
    const context = observation([worker, carrier]);
    expect(committedWorkerInputs(context, building, "logs")).toBe(2);
    expect(reservedInputReturns(context, building, "logs")).toBe(1);
    expect(unusedSawmillInputs(context, building)).toEqual([["logs", 4]]);
    building.selectedOutput = "planks";
    expect(unusedSawmillInputs(context, building)).toEqual([]);
    expect(reservedInputReturns(context, building, "logs")).toBe(1);
    expect(building.input.logs).toBe(4);
  });
  it("does not reserve a picked-up worker receipt twice or count carried returns as input stock", () => {
    const building = sawmill({ worker: 7, workshopUpgrade: { level: 1 }, selectedOutput: "hardwoodPlanks",
      input: { logs: 2 } });
    const worker = actor({ uid: 7, job: "Carpenter", phase: "inputReturnBlocked", ware: "logs",
      productionInputs: ["logs", "logs"], consumed: { logs: 1 } });
    const carrier = actor({ ware: "logs", delivery: { source: 1, destination: 0,
      ware: "logs", sourceInput: true, reserved: false } });
    const context = observation([worker, carrier]);
    expect(committedWorkerInputs(context, building, "logs")).toBe(1);
    expect(reservedInputReturns(context, building, "logs")).toBe(0);
    expect(unusedSawmillInputs(context, building)).toEqual([["logs", 2]]);
  });
});

const carrierFixture = () => {
  const size = 48;
  const world = { cellsX: size, cellsZ: size, heights: new Float32Array((size + 1) ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), blocking: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), props: { count: 0 },
    mineZones: [], oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2)
  } as unknown as WorldData;
  const context = { options: { world }, actors: [], buildings: [], nextBuilding: 0, nextActor: 1,
    occupied: new Uint8Array(size ** 2), reservations: new Set(), settlers: 0, transfers: [],
    resourceAmounts: new Map(), accumulator: 0, scheduling: 0 } as unknown as SettlementContext;
  const home = makeBuilding(context, 0, 6, 6), source = makeBuilding(context, 33, 22, 20);
  home.construction = source.construction = 1;
  source.workshopUpgrade = { level: 1 }; source.selectedOutput = "hardwoodPlanks"; source.input.logs = 1;
  context.buildings.push(home, source);
  context.options.roads = createRoadNetwork(world);
  // The road skirts the sawmill: since the building navigation profile its footprint blocks walkers.
  const corner = { x: home.access.x, z: source.access.z };
  context.options.roads.addRoad(home.access, corner);
  context.options.roads.addRoad(corner, source.access);
  context.actors.push(actor({ uid: 0, home: home.uid, building: home.uid, phase: "inside", visible: false,
    x: home.x, z: home.z, y: 0, yaw: 0, action: "idle", animationTime: 0,
    path: [], pathIndex: 0, timer: 0 }));
  return { context, home, source };
};

describe("physical input return scheduling", () => {
  it("releases a cancelled pickup reservation without manufacturing or removing source input", () => {
    const { context, home, source } = carrierFixture();
    scheduleDeliveries(context);
    const carrier = context.actors[0]!;
    expect(cancelUnreachableTask(context, carrier)).toBe(true);
    expect(carrier.delivery).toBeUndefined();
    expect(source.input.logs).toBe(1);
    expect(home.inventory.logs ?? 0).toBe(0); expect(home.incoming.logs ?? 0).toBe(0);
    expect(reservedInputReturns(context, source, "logs")).toBe(0);
  });
  it("holds obsolete inputs with no accepting storage and reserves without teleporting when one is available", () => {
    const { context, home, source } = carrierFixture();
    home.accepts.logs = false;
    scheduleDeliveries(context);
    expect(source.input.logs).toBe(1); expect(home.inventory.logs ?? 0).toBe(0);
    expect(context.actors[0]!.delivery).toBeUndefined();
    home.accepts.logs = true;
    scheduleDeliveries(context);
    expect(context.actors[0]!.delivery).toMatchObject({ sourceInput: true, reserved: true, ware: "logs" });
    expect(source.input.logs).toBe(1); expect(home.incoming.logs).toBe(1);
    expect(home.inventory.logs ?? 0).toBe(0);
    scheduleDeliveries(context);
    expect(context.actors).toHaveLength(1);
    expect(reservedInputReturns(context, source, "logs")).toBe(1);
  });
  it("picks an obsolete log from the input bay and deposits it in storage exactly once", () => {
    const { context, home, source } = carrierFixture();
    scheduleDeliveries(context);
    const carrier = context.actors[0]!;
    let pickupObserved = false;
    for (let tick = 0; tick < 8000 && !(home.inventory.logs ?? 0); tick++) {
      updateCarrier(context, carrier, .05);
      if (carrier.phase === "pickupTransfer") {
        pickupObserved = true;
        expect(source.input.logs ?? 0).toBe(0);
        expect(carrier.ware).toBe("logs");
        expect(carrier.wareTransfer?.direction).toBe("pickup");
        expect(home.inventory.logs ?? 0).toBe(0);
      }
    }
    expect(pickupObserved).toBe(true);
    expect(home.inventory.logs).toBe(1); expect(home.incoming.logs ?? 0).toBe(0);
    expect(source.input.logs ?? 0).toBe(0);
    for (let tick = 0; tick < 20; tick++) updateCarrier(context, carrier, .05);
    expect(home.inventory.logs).toBe(1);
  });
});
