import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createHeadlessIsland } from "../src/app/settlement/headless-replay";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { advanceUntil as advanceFixture, grantSoldiers, troopShipFixture } from "./helpers/troop-ship-fixture";

/**
 * Seed 123 (size 128, harbour by the map's east edge), captured in the real game on 2026-11-17 with the master
 * code: troop ship 1 lies at the harbour berth with three soldiers aboard, free ship 2 waits off the harbour and
 * five field soldiers stand on a coast south-west of it. Before the fix ship 2 fetched them from an anchorage on
 * the harbour's way out to sea, ship 1 kept the berth and the two ships shut each other in: ship 2 never sailed
 * past the harbour (more than 150 s).
 */
const HARBOUR_SHIP = 1, PICKUP_SHIP = 2, SQUAD = [3, 4, 5, 6, 7], OLD_LANE_ANCHORAGE = { x: 115.75, z: 109.5 };
/** The coast where the squad stands, beyond the channel's mouth. */
const SOUTH_WEST_COAST = { x: 102.5, z: 110.5 };

const loadBay = async () => {
  const file = resolve("tests/fixtures/troop-ship-bay-deadlock.save.json");
  const save: GameSaveV1 = JSON.parse(await readFile(file, "utf8"));
  return (await createHeadlessIsland(save)).simulation;
};
type Simulation = Awaited<ReturnType<typeof loadBay>>;
const shipOf = (simulation: Pick<Simulation, "ships">, id: number) => simulation.ships().find(ship => ship.id === id)!;
const advanceUntil = (simulation: Simulation, done: () => boolean, ticks: number) => {
  for (let tick = 0; tick < ticks && !done(); tick++) simulation.update(.05);
  return done();
};

describe("troop ship at a harbour berth makes way (seed 123 bay)", () => {
  it("no ship shuts the other in: the pickup keeps off the harbour lanes, the troop ship off its way", async () => {
    const simulation = await loadBay();
    const harbourUid = simulation.troopShipStatus(HARBOUR_SHIP)!.harbourUid!;
    const berth = simulation.harbourBerths(harbourUid)[0]!;
    const aside = () => {
      const ship = shipOf(simulation, HARBOUR_SHIP);
      return ship.phase === "loading" && Math.hypot(ship.x - berth.x, ship.z - berth.z) > 6;
    };
    expect(simulation.embarkMilitary(SQUAD, PICKUP_SHIP)).toMatchObject({ ok: true, waiting: [] });
    const pickedUp = () => simulation.troopShipStatus(PICKUP_SHIP)!.aboard === SQUAD.length;
    expect(advanceUntil(simulation, pickedUp, 8000)).toBe(true);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    // Before the fix the pickup anchored on the harbour's way out to sea (115.75, 109.5), beside its exit.
    const saved = simulation.saveState().naval.fleet.ships.find(ship => ship.id === PICKUP_SHIP)!;
    const anchor = saved.troopMission!.anchor!;
    expect(Math.hypot(anchor.water.x - OLD_LANE_ANCHORAGE.x, anchor.water.z - OLD_LANE_ANCHORAGE.z)).toBeGreaterThan(8);
    // The bay's only waiting spot is the mouth of the pocket the pickup lies in: the loaded troop ship keeps the
    // berth rather than shut the pickup in, and stays orderable.
    expect(aside()).toBe(false);
    expect(simulation.landShipTroops(HARBOUR_SHIP, { harbourUid })).toEqual({ kind: "harbour", ok: true });
    expect(advanceUntil(simulation, () => !simulation.troopShipStatus(HARBOUR_SHIP)!.mission, 8000)).toBe(true);
  }, 240_000);
});

describe("narrow channel harbour: a ship with no waiting spot sails out to let another pass (seed 123)", () => {
  /** Ship id, phase and pose of every ship (the deterministic part a twin run must repeat). */
  const fleetPoses = (simulation: Simulation) => simulation.ships().map(({ id, phase, x, z }) => ({ id, phase, x, z }));

  it("the loaded troop ship at the berth waits outside while the pickup comes in, then returns", async () => {
    const simulation = await loadBay();
    const harbourUid = simulation.troopShipStatus(HARBOUR_SHIP)!.harbourUid!;
    expect(simulation.embarkMilitary(SQUAD, PICKUP_SHIP)).toMatchObject({ ok: true, waiting: [] });
    expect(advanceUntil(simulation, () => simulation.troopShipStatus(PICKUP_SHIP)!.aboard === SQUAD.length, 8000))
      .toBe(true);
    // Before: the pickup's harbour order waited for ever behind the loaded ship holding the only berth.
    expect(simulation.landShipTroops(PICKUP_SHIP, { harbourUid })).toEqual({ kind: "harbour", ok: true });
    const outside = () => shipOf(simulation, HARBOUR_SHIP).phase === "away";
    expect(advanceUntil(simulation, outside, 4000)).toBe(true);
    expect(simulation.troopShipStatus(HARBOUR_SHIP)).toMatchObject({ aboard: 3, mission: true });
    // Outside is saved: a reload and a fresh twin both carry on identically.
    const saved = structuredClone(simulation.saveState());
    expect(simulation.loadState(structuredClone(saved))).toEqual({ ok: true });
    const twin = await loadBay();
    expect(twin.loadState(structuredClone(saved))).toEqual({ ok: true });
    for (let tick = 0; tick < 600; tick++) { simulation.update(.05); twin.update(.05); }
    expect(fleetPoses(twin)).toEqual(fleetPoses(simulation));
    // The pickup reaches the berth and lands its squad; the troop ship comes back in with its soldiers.
    const passed = () => !simulation.troopShipStatus(PICKUP_SHIP)!.mission;
    expect(advanceUntil(simulation, passed, 8000)).toBe(true);
    const back = () => shipOf(simulation, HARBOUR_SHIP).phase === "loading";
    expect(advanceUntil(simulation, back, 8000)).toBe(true);
    expect(simulation.troopShipStatus(HARBOUR_SHIP)).toMatchObject({ aboard: 3, mission: true });
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  }, 240_000);

  it("an idle ship on the only waiting spot sails out for a departing troop ship and comes back", async () => {
    const simulation = await loadBay();
    // Ship 2 lies idle at the bay's one waiting spot, the mouth of the channel the loaded troop ship must pass.
    expect(shipOf(simulation, PICKUP_SHIP).phase).toBe("idle");
    expect(simulation.landShipTroops(HARBOUR_SHIP, SOUTH_WEST_COAST)).toEqual({ kind: "coast", ok: true });
    expect(advanceUntil(simulation, () => shipOf(simulation, PICKUP_SHIP).phase === "away", 2000)).toBe(true);
    const landed = () => simulation.troopShipStatus(HARBOUR_SHIP)!.anchored &&
      simulation.troopShipStatus(HARBOUR_SHIP)!.aboard === 0;
    expect(advanceUntil(simulation, landed, 6000)).toBe(true);
    expect(advanceUntil(simulation, () => shipOf(simulation, PICKUP_SHIP).phase === "idle", 8000)).toBe(true);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  }, 240_000);
});

describe("troop ship at a harbour berth makes way (open water)", () => {
  it("leaves the berth with its troops once boarded, and comes back to it for more soldiers", () => {
    const { shipId, simulation } = troopShipFixture();
    const first = grantSoldiers(simulation, ["shield", "archer"]);
    expect(simulation.embarkMilitary(first, shipId)).toMatchObject({ ok: true });
    const berth = simulation.harbourBerths(simulation.troopShipStatus(shipId)!.harbourUid!)[0]!;
    const waiting = () => {
      const ship = shipOf(simulation, shipId);
      return ship.phase === "loading" && Math.hypot(ship.x - berth.x, ship.z - berth.z) > 6;
    };
    expect(advanceFixture(simulation, waiting, 8000)).toBe(true);
    expect(simulation.troopShipStatus(shipId)).toMatchObject({ aboard: 2, harbourUid: undefined, mission: true });
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    const more = grantSoldiers(simulation, ["heavy"]);
    expect(simulation.embarkMilitary(more, shipId)).toMatchObject({ boarding: more, ok: true });
    expect(advanceFixture(simulation, () => simulation.troopShipStatus(shipId)!.aboard === 3, 8000)).toBe(true);
    expect(advanceFixture(simulation, waiting, 8000)).toBe(true);
  }, 120_000);

  it("fetches stored soldiers at their harbour with a free ship from far off", () => {
    const { simulation } = troopShipFixture();
    const far = simulation.spawnDebugShip({ x: 72.5, z: 50.5 });
    expect(far).toMatchObject({ ok: true });
    const shipId = (far as { id: number }).id;
    const stored = grantSoldiers(simulation, ["shield", "heavy"]);
    expect(simulation.troopShipBoardingCheck(stored, shipId))
      .toMatchObject({ anchored: false, boarding: stored, ok: true });
    expect(simulation.embarkMilitary(stored, shipId)).toMatchObject({ boarding: stored, ok: true });
    expect(advanceFixture(simulation, () => simulation.troopShipStatus(shipId)!.aboard === 2, 12000)).toBe(true);
  }, 120_000);
});
