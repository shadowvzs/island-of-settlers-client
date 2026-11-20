import { shipDeckCapacity } from "@shared/catalog";
import { describe, expect, it } from "vitest";

import { TROOP_GANGWAY_SITE_ID_OFFSET } from "../src/shared/settlement/constants";
import { advanceUntil, grantSoldiers, troopShipFixture } from "./helpers/troop-ship-fixture";

const EAST_COAST = { x: 106.5, z: 30.5 };
const WATER_EAST_EDGE = 103;

type Fixture = ReturnType<typeof troopShipFixture>;

/** A full deck load (a rider among them) landed on the east shore by the fixture ship, which stays anchored there. */
const landEastTroops = ({ shipId, simulation }: Fixture) => {
  const ids = grantSoldiers(simulation, [...Array(12).fill("shield"), "heavy", "archer", "cavalry"]);
  simulation.embarkMilitary(ids, shipId);
  expect(simulation.landShipTroops(shipId, EAST_COAST)).toEqual({ kind: "coast", ok: true });
  const landed = () => simulation.frames().filter(actor => ids.includes(actor.uid))
    .every(actor => actor.phase === "militaryField" && actor.action === "idle" && actor.x > WATER_EAST_EDGE);
  expect(advanceUntil(simulation, () => simulation.troopShipStatus(shipId)?.landing === 0 && landed(), 20000))
    .toBe(true);
  return ids;
};

const shipOf = (simulation: Fixture["simulation"], id: number) => simulation.ships().find(ship => ship.id === id)!;
const gangwayOf = (simulation: Fixture["simulation"], id: number) =>
  simulation.shipSites().find(site => site.id === TROOP_GANGWAY_SITE_ID_OFFSET + id);

describe("troop ship coast pickup (owner 2026-11-17)", () => {
  it("fetches soldiers from their coast: they wait at the gangway foot, then walk aboard", () => {
    const fixture = troopShipFixture(), { simulation, source } = fixture;
    const ids = landEastTroops(fixture);
    expect(simulation.debugEnsureFreeShips(source.uid, 1).free).toBe(1);
    const pickupId = simulation.ships().find(ship => ship.id !== fixture.shipId)!.id;
    expect(simulation.troopShipActions(pickupId)).toMatchObject({ board: true });
    const everyone = expect.arrayContaining(ids);
    expect(simulation.troopShipBoardingCheck(ids, pickupId)).toMatchObject({ boarding: everyone, waiting: [] });
    expect(simulation.embarkMilitary(ids, pickupId)).toEqual({ boarding: everyone, ok: true, waiting: [] });
    expect(shipOf(simulation, pickupId).phase).toBe("sailing");
    expect(gangwayOf(simulation, pickupId)).toBeUndefined();
    // While the ship sails over, the soldiers walk to the gangway foot and wait there on dry land.
    for (let tick = 0; tick < 400; tick++) simulation.update(.05);
    const saved = structuredClone(simulation.saveState());
    expect(simulation.loadState(saved)).toEqual({ ok: true });
    expect(shipOf(simulation, pickupId).phase).toBe("sailing");
    const waiting = simulation.frames().filter(actor => ids.includes(actor.uid));
    expect(waiting.every(actor => actor.phase === "militaryField" && actor.x > WATER_EAST_EDGE)).toBe(true);
    const anchored = () => simulation.troopShipStatus(pickupId)?.anchored === true;
    expect(advanceUntil(simulation, anchored, 20000)).toBe(true);
    expect(gangwayOf(simulation, pickupId)?.workPier).toBeDefined();
    let reloaded = false;
    const allAboard = () => {
      if (!reloaded && simulation.frames().some(actor => actor.phase === "navalBoarding")) {
        expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
        reloaded = true;
      }
      const status = simulation.troopShipStatus(pickupId)!;
      return status.ready && status.aboard === ids.length;
    };
    expect(advanceUntil(simulation, allAboard, 20000)).toBe(true);
    expect(reloaded).toBe(true);
    expect(simulation.sailShip(pickupId, { harbourUid: source.uid })).toEqual({ kind: "harbour", ok: true });
    expect(advanceUntil(simulation, () => shipOf(simulation, pickupId).phase === "sailing", 400)).toBe(true);
    expect(gangwayOf(simulation, pickupId)).toBeUndefined();
  }, 240_000);

  it("splits a selection larger than the deck: the rest wait inland, clear of the gangway foot", () => {
    const { shipId, simulation } = troopShipFixture();
    const ids = Array.from({ length: shipDeckCapacity().passengers + 2 }, (_, index) =>
      simulation.spawnDebugSoldier({ x: 112.5 + index % 4, z: 26.5 + Math.floor(index / 4) },
        { rank: 0, type: "shield" })!.id);
    const result = simulation.embarkMilitary(ids, shipId);
    expect(result).toMatchObject({ ok: true, waiting: expect.any(Array) });
    if (!result.ok) return;
    expect(result.boarding).toHaveLength(shipDeckCapacity().passengers);
    expect(result.waiting).toHaveLength(2);
    expect(advanceUntil(simulation, () => simulation.troopShipStatus(shipId)!.ready &&
      simulation.troopShipStatus(shipId)!.aboard === result.boarding.length, 20000)).toBe(true);
    const foot = gangwayOf(simulation, shipId)!.workPier!.shore;
    const left = simulation.frames().filter(actor => result.waiting.includes(actor.uid));
    expect(left.every(actor => actor.phase === "militaryField" && actor.x > WATER_EAST_EDGE &&
      Math.hypot(actor.x - foot.x, actor.z - foot.z) > 3)).toBe(true);
  }, 120_000);

  it("keeps harbour boarding for soldiers on the harbour's shore and refuses when nobody can walk aboard", () => {
    const { shipId, simulation } = troopShipFixture();
    const stored = grantSoldiers(simulation, ["shield"]);
    expect(simulation.troopShipBoardingCheck(stored, shipId)).toMatchObject({ anchored: false, ok: true });
    expect(simulation.embarkMilitary([], shipId)).toEqual({ ok: false, reason: "No chosen soldier can board" });
  }, 60_000);
});
