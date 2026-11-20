import { shipDeckCapacity } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { WorldData } from "../src/shared/world/world-data";
import { edgeBayWorld } from "./helpers/edge-bay-settlement";
import { advanceUntil, grantSoldiers, troopShipFixture } from "./helpers/troop-ship-fixture";

const EAST_COAST = { x: 106.5, z: 30.5 };

const statusOf = (simulation: ReturnType<typeof troopShipFixture>["simulation"], shipId: number) =>
  simulation.troopShipStatus(shipId)!;

describe("troop ships (MIL-SHIPS-SIM)", () => {
  it("boards the nearest soldiers until the deck is full and leaves the rest waiting", () => {
    const { shipId, simulation } = troopShipFixture();
    const slots = shipDeckCapacity().passengers;
    const ids = grantSoldiers(simulation, [...Array(6).fill("shield"), ...Array(6).fill("cavalry")]);
    const result = simulation.embarkMilitary(ids, shipId);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const typeOf = (uid: number) => simulation.militarySoldiers().find(soldier => soldier.actor === uid)!.combat!.type;
    const used = result.boarding.reduce((sum, uid) => sum + (typeOf(uid) === "cavalry" ? 2 : 1), 0);
    expect(used).toBeLessThanOrEqual(slots);
    expect(result.waiting.length).toBeGreaterThan(0);
    const byUid = (a: number, b: number) => a - b;
    expect([...result.boarding, ...result.waiting].sort(byUid)).toEqual([...ids].sort(byUid));
    expect(simulation.troopShipBoardingCheck(result.waiting, shipId)).toMatchObject({ ok: true, boarding: [] });
    expect(advanceUntil(simulation, () => statusOf(simulation, shipId).ready)).toBe(true);
    expect(statusOf(simulation, shipId)).toMatchObject({ aboard: result.boarding.length, anchored: false });
    expect(simulation.ships().find(ship => ship.id === shipId)?.phase).toBe("loading");
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 120_000);

  it("refuses to sail an empty ship and to land on invalid coasts", () => {
    const { destination, shipId, simulation } = troopShipFixture();
    expect(simulation.sailShip(shipId, { harbourUid: destination.uid })).toMatchObject({ ok: false });
    expect(simulation.landShipTroops(shipId, EAST_COAST)).toMatchObject({ ok: false });
    expect(simulation.troopShipDestinationCheck(shipId, EAST_COAST)).toEqual({ kind: "coast", ok: true });
    expect(simulation.troopShipDestinationCheck(shipId, { x: 140.5, z: 30.5 }))
      .toEqual({ ok: false, reason: "No landing beach here" });
    expect(simulation.troopShipDestinationCheck(shipId, { x: 70.5, z: 30.5 }))
      .toEqual({ ok: false, reason: "Choose a coast on land" });
    expect(simulation.troopShipDestinationCheck(shipId, { x: -4, z: 30 }))
      .toEqual({ ok: false, reason: "Choose a point on the map" });
    expect(simulation.troopShipDestinationCheck(shipId, { harbourUid: destination.uid }))
      .toEqual({ kind: "harbour", ok: true });
  }, 60_000);

  it("sails boarded troops across the strait, survives a reload mid-voyage and lands them on the coast", () => {
    const { shipId, simulation } = troopShipFixture();
    const ids = grantSoldiers(simulation, ["shield", "heavy", "archer", "cavalry"]);
    expect(simulation.embarkMilitary(ids, shipId)).toMatchObject({ boarding: expect.any(Array), ok: true });
    expect(simulation.landShipTroops(shipId, EAST_COAST)).toEqual({ kind: "coast", ok: true });
    const sailing = () => simulation.ships().find(ship => ship.id === shipId)!.phase === "sailing";
    expect(advanceUntil(simulation, sailing)).toBe(true);
    for (let tick = 0; tick < 200; tick++) simulation.update(.05);
    const saved = structuredClone(simulation.saveState());
    for (let tick = 0; tick < 100; tick++) simulation.update(.05);
    const live = simulation.shipFrames().find(ship => ship.id === shipId)!;
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    for (let tick = 0; tick < 100; tick++) simulation.update(.05);
    const restored = simulation.shipFrames().find(ship => ship.id === shipId)!;
    expect({ x: restored.x, yaw: restored.yaw, z: restored.z }).toEqual({ x: live.x, yaw: live.yaw, z: live.z });
    const ashore = () => simulation.frames().filter(actor => ids.includes(actor.uid))
      .every(actor => ["militaryField", "militaryLeaving"].includes(actor.phase) && actor.x > 103);
    expect(advanceUntil(simulation, () => simulation.troopShipStatus(shipId)?.landing === 0 &&
      statusOf(simulation, shipId).anchored && ashore(), 20000)).toBe(true);
    expect(simulation.ships().find(ship => ship.id === shipId)).toMatchObject({ passengers: 0, phase: "loading" });
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 180_000);

  it("re-boards landed soldiers at the anchored ship and lands them into a harbour", () => {
    const { destination, shipId, simulation } = troopShipFixture();
    const ids = grantSoldiers(simulation, ["shield", "heavy"]);
    simulation.embarkMilitary(ids, shipId);
    simulation.landShipTroops(shipId, EAST_COAST);
    const landed = () => simulation.frames().filter(actor => ids.includes(actor.uid))
      .every(actor => actor.phase === "militaryField" && actor.action === "idle");
    expect(advanceUntil(simulation, () => statusOf(simulation, shipId).anchored &&
      statusOf(simulation, shipId).landing === 0 && landed(), 20000)).toBe(true);
    expect(simulation.troopShipActions(shipId)).toMatchObject({ board: true, multiIsland: true, role: "home" });
    const again = simulation.embarkMilitary(ids, shipId);
    // Nearest the ship first: who landed first depends on where each stood on deck.
    expect(again).toMatchObject({ ok: true, waiting: [] });
    expect(again.ok && [...again.boarding].sort((a, b) => a - b)).toEqual(ids);
    let reloaded = false;
    expect(advanceUntil(simulation, () => {
      if (!reloaded && simulation.frames().some(actor => actor.phase === "navalBoarding")) {
        expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
        reloaded = true;
      }
      return statusOf(simulation, shipId).ready && statusOf(simulation, shipId).aboard === ids.length;
    }, 20000)).toBe(true);
    expect(reloaded).toBe(true);
    expect(simulation.landShipTroops(shipId, { harbourUid: destination.uid })).toEqual({ kind: "harbour", ok: true });
    const stored = () => simulation.frames().filter(actor => ids.includes(actor.uid))
      .every(actor => actor.phase === "militaryReserve" && actor.home === destination.uid);
    expect(advanceUntil(simulation, () => stored() && !statusOf(simulation, shipId).mission, 20000)).toBe(true);
    expect(simulation.ships().find(ship => ship.id === shipId)).toMatchObject({ passengers: 0 });
    expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  }, 180_000);

  it("lands on a hostile coast that today's landing rules accept", () => {
    const { shipId, simulation } = troopShipFixture();
    const fort = simulation.placeMilitaryScenarioBuilding(1, 112, 30);
    expect(fort.ok, JSON.stringify(fort)).toBe(true);
    const ids = grantSoldiers(simulation, ["shield"]);
    simulation.embarkMilitary(ids, shipId);
    expect(simulation.landShipTroops(shipId, EAST_COAST)).toEqual({ kind: "coast", ok: true });
  }, 60_000);

  it("rejects a saved mission whose soldier is held twice", () => {
    const { shipId, simulation } = troopShipFixture();
    const ids = grantSoldiers(simulation, ["shield", "heavy"]);
    simulation.embarkMilitary(ids, shipId);
    expect(advanceUntil(simulation, () => statusOf(simulation, shipId).ready)).toBe(true);
    const saved = structuredClone(simulation.saveState());
    const ship = saved.naval.fleet.ships.find(entry => entry.id === shipId)!;
    expect(ship.troopMission).toBeDefined();
    ship.troopMission!.boarding.push(ship.passengers![0]!);
    expect(simulation.loadState(saved).ok).toBe(false);
  }, 60_000);

  it("keeps the colony path: one deck load is called with the recorded troop pickup", () => {
    const world = edgeBayWorld();
    world.start = { x: 32, z: 42 };
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 30,
      roads, world });
    // The role only (no authored camps): this harbour island is read as a colony from now on.
    world.scenario = { kind: "colony" } as WorldData["scenario"];
    expect(simulation.islandRole()).toBe("colony");
    const ids = grantSoldiers(simulation, Array(shipDeckCapacity().passengers + 3).fill("shield"));
    const result = simulation.embarkMilitary(ids, 0);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.boarding).toHaveLength(shipDeckCapacity().passengers);
    expect(result.waiting).toHaveLength(3);
    expect(simulation.ships().filter(ship => ship.troopRecall)).toHaveLength(1);
    expect(simulation.troopShipBoardingCheck(result.waiting, 0)).toMatchObject({ ok: true, pickup: true });
  }, 60_000);

  it("sails a boarded ship to another harbour, where it docks with the troops still aboard", () => {
    const { destination, shipId, simulation } = troopShipFixture();
    const ids = grantSoldiers(simulation, ["shield", "archer"]);
    simulation.embarkMilitary(ids, shipId);
    expect(simulation.sailShip(shipId, { harbourUid: destination.uid })).toEqual({ kind: "harbour", ok: true });
    const docked = () => {
      const status = statusOf(simulation, shipId);
      return status.harbourUid === destination.uid && status.aboard === ids.length &&
        simulation.ships().find(ship => ship.id === shipId)?.phase === "loading";
    };
    expect(advanceUntil(simulation, docked, 20000)).toBe(true);
    expect(simulation.troopShipActions(shipId)).toMatchObject({ carrying: true, sailTo: true, unload: true });
  }, 120_000);
});
