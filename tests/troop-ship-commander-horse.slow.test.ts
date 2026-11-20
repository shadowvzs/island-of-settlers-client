import { describe, expect, it } from "vitest";

import { SHIP_DECK_HORSE_WORLD } from "../src/render-common/ships/ship-deck-layout";
import { TROOP_HORSE_LEAD_DISTANCE } from "../src/shared/settlement/constants";
import { advanceUntil, finishedBuilding, troopShipFixture } from "./helpers/troop-ship-fixture";

type Fixture = ReturnType<typeof troopShipFixture>;
type Simulation = Fixture["simulation"];

const EAST_SHORE = { x: 112.5, z: 26.5 };
/** Further down the east shore: the ship carries the commander along the coast and lands him there. */
const SOUTH_COAST = { x: 106.5, z: 50.5 };
const COMMANDER_LODGE = 62;

/** The fixture with a recruited commander standing mounted in the field at `at` (and his horse's id). */
const withFieldCommander = (at: { x: number; z: number }) => {
  const fixture = troopShipFixture(), { simulation } = fixture;
  Object.assign(simulation.headquarters.inventory, { beer: 40, coins: 40, shield: 6, sword: 6, wine: 40 });
  const lodge = finishedBuilding(simulation, COMMANDER_LODGE, 14, 22);
  const recruited = simulation.recruitCommander(lodge.uid);
  expect(recruited.ok, JSON.stringify(recruited)).toBe(true);
  const saved = simulation.saveState(), soldier = saved.military!.soldiers.find(row => row.commanderId)!;
  const actor = saved.actors.find(row => row.uid === soldier.actor)!;
  Object.assign(actor, { mounted: true, phase: "militaryField", visible: true, x: at.x, yaw: 0, z: at.z });
  soldier.building = -3;
  saved.military!.commander!.location = "field";
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  return { ...fixture, commander: soldier.actor, horse: soldier.combat!.mount! };
};

const actorOf = (simulation: Simulation, uid: number) => simulation.frames().find(actor => actor.uid === uid)!;
const horseFrameOf = (simulation: Simulation, uid: number) => simulation.horseFrames().find(frame => frame.id === uid);
const shipOf = (simulation: Simulation, id: number) => simulation.ships().find(ship => ship.id === id)!;
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Nobody aboard stands inside the horse: its body is a capsule along its heading (tiles). */
const clearOfHorse = (simulation: Simulation, ship: number, horse: number, rider: number) => {
  const frame = horseFrameOf(simulation, horse)!, half = SHIP_DECK_HORSE_WORLD.depth / 2;
  const along = { x: Math.sin(frame.heading), z: Math.cos(frame.heading) };
  const people = simulation.saveState().naval.fleet.ships.find(entry => entry.id === ship)!.passengers ?? [];
  return people.filter(uid => uid !== rider).every(uid => {
    const body = actorOf(simulation, uid), dx = body.x - frame.x, dz = body.z - frame.z;
    const ahead = Math.max(-half, Math.min(half, dx * along.x + dz * along.z));
    return distance(body, { x: frame.x + along.x * ahead, z: frame.z + along.z * ahead }) >
      SHIP_DECK_HORSE_WORLD.width / 2;
  });
};

/** Ticks until `done`, keeping the led horse within its lead of the commander the whole way. */
const advanceLeading = (fixture: ReturnType<typeof withFieldCommander>, done: () => boolean, ticks: number) => {
  const { commander, horse, simulation } = fixture;
  let led = 0;
  const finished = advanceUntil(simulation, () => {
    const rider = actorOf(simulation, commander), body = actorOf(simulation, horse);
    if (["navalBoarding", "navalDeckWalk"].includes(rider.phase)) {
      led++;
      expect(body.visible).toBe(true);
      expect(distance(rider, body)).toBeLessThanOrEqual(TROOP_HORSE_LEAD_DISTANCE + .2);
      expect(horseFrameOf(simulation, horse)).toMatchObject({ held: true, leader: commander });
    }
    return done();
  }, ticks);
  return { finished, led };
};

describe("the commander's horse aboard a troop ship (2026-11-17)", () => {
  it("leads it up a coast gangway, stands it on deck for the voyage, rides it off at the landing", () => {
    const fixture = withFieldCommander(EAST_SHORE), { commander, horse, shipId, simulation } = fixture;
    const result = simulation.embarkMilitary([commander], shipId);
    expect(result).toEqual({ boarding: [commander], ok: true, waiting: [] });
    let reloaded = false;
    const boarded = advanceLeading(fixture, () => {
      if (!reloaded && actorOf(simulation, commander).phase === "navalBoarding") {
        expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
        reloaded = true;
      }
      return Boolean(simulation.troopShipStatus(shipId)?.ready) &&
        actorOf(simulation, horse).action === "idle";
    }, 30000);
    expect(boarded.finished).toBe(true);
    expect(boarded.led).toBeGreaterThan(10);
    expect(reloaded).toBe(true);
    const rider = actorOf(simulation, commander), standing = horseFrameOf(simulation, horse)!;
    expect(rider).toMatchObject({ mounted: false, phase: "navalAboard" });
    expect(standing).toMatchObject({ held: true, leader: commander, moving: false });
    expect(distance(rider, standing)).toBeLessThan(1.7);
    // Voyage: the horse goes with the deck, survives a save under way, and the ship lands them further down the shore.
    expect(simulation.landShipTroops(shipId, SOUTH_COAST)).toMatchObject({ kind: "coast", ok: true });
    expect(advanceUntil(simulation, () => shipOf(simulation, shipId).phase === "sailing", 400)).toBe(true);
    for (let tick = 0; tick < 200; tick++) simulation.update(.05);
    const atSea = horseFrameOf(simulation, horse)!, ship = shipOf(simulation, shipId);
    expect(distance(atSea, ship)).toBeLessThan(3.5);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    expect(horseFrameOf(simulation, horse)).toMatchObject({ held: true, leader: commander });
    const landed = () => actorOf(simulation, commander).phase === "militaryField" &&
      simulation.troopShipStatus(shipId)?.landing === 0;
    expect(advanceUntil(simulation, landed, 30000)).toBe(true);
    expect(actorOf(simulation, commander)).toMatchObject({ mounted: true, visible: true });
    expect(distance(actorOf(simulation, commander), SOUTH_COAST)).toBeLessThan(16);
    expect(actorOf(simulation, horse).visible).toBe(false);
    expect(horseFrameOf(simulation, horse)?.visible ?? false).toBe(false);
  }, 240_000);

  it("keeps the deck clear round the horse with a full load, refuses when no room is left for it", () => {
    const fixture = withFieldCommander(EAST_SHORE), { commander, horse, shipId, simulation } = fixture;
    const foot = Array.from({ length: 12 }, (_, index) => simulation.spawnDebugSoldier(
      { x: 113.5 + index % 4, z: 28.5 + Math.floor(index / 4) }, { rank: 0, type: "shield" })!.id);
    const result = simulation.embarkMilitary([commander, ...foot], shipId);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    // Six places for the commander and his horse: ten soldiers on foot fit beside them, the rest wait ashore.
    expect(result.boarding).toContain(commander);
    expect(result.boarding).toHaveLength(11);
    expect(advanceUntil(simulation, () => Boolean(simulation.troopShipStatus(shipId)?.ready) &&
      simulation.troopShipStatus(shipId)!.aboard === 11 && actorOf(simulation, horse).action === "idle", 30000))
      .toBe(true);
    expect(clearOfHorse(simulation, shipId, horse, commander)).toBe(true);
    const second = withFieldCommander(EAST_SHORE);
    const full = Array.from({ length: 11 }, (_, index) => second.simulation.spawnDebugSoldier(
      { x: 113.5 + index % 4, z: 28.5 + Math.floor(index / 4) }, { rank: 0, type: "shield" })!.id);
    expect(second.simulation.embarkMilitary(full, second.shipId)).toMatchObject({ ok: true });
    expect(second.simulation.embarkMilitary([second.commander], second.shipId))
      .toEqual({ ok: false, reason: "No deck room for the commander's horse" });
  }, 240_000);

  it("boards over a harbour pier and lands at a harbour mounted, never stored", () => {
    const fixture = withFieldCommander({ x: 30.5, z: 14.5 });
    const { commander, destination, horse, shipId, simulation } = fixture;
    const result = simulation.embarkMilitary([commander], shipId);
    expect(result).toEqual({ boarding: [commander], ok: true, waiting: [] });
    expect(simulation.troopShipBoardingCheck([commander], shipId)).toMatchObject({ anchored: false });
    const boarded = advanceLeading(fixture, () => Boolean(simulation.troopShipStatus(shipId)?.ready) &&
      actorOf(simulation, horse).action === "idle", 30000);
    expect(boarded.finished).toBe(true);
    expect(boarded.led).toBeGreaterThan(10);
    expect(simulation.landShipTroops(shipId, { harbourUid: destination.uid })).toEqual({ kind: "harbour", ok: true });
    const ashore = advanceLeading(fixture, () => actorOf(simulation, commander).phase === "militaryField", 30000);
    expect(ashore.finished).toBe(true);
    expect(actorOf(simulation, commander)).toMatchObject({ mounted: true, visible: true });
    expect(actorOf(simulation, horse).visible).toBe(false);
    expect(distance(actorOf(simulation, commander), destination.access)).toBeLessThan(12);
    expect(advanceUntil(simulation, () => !simulation.troopShipStatus(shipId)?.mission, 4000)).toBe(true);
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  }, 240_000);

  it("hands the deck over to the coast landing without shifting or turning anyone (2026-11-17)", () => {
    const fixture = withFieldCommander(EAST_SHORE), { commander, horse, shipId, simulation } = fixture;
    const foot = Array.from({ length: 5 }, (_, index) => simulation.spawnDebugSoldier(
      { x: 113.5 + index % 3, z: 28.5 + Math.floor(index / 3) }, { rank: 0, type: "shield" })!.id);
    expect(simulation.embarkMilitary([commander, ...foot], shipId)).toMatchObject({ ok: true });
    expect(advanceUntil(simulation, () => Boolean(simulation.troopShipStatus(shipId)?.ready) &&
      simulation.troopShipStatus(shipId)!.aboard === 6 && actorOf(simulation, horse).action === "idle", 30000))
      .toBe(true);
    expect(simulation.landShipTroops(shipId, SOUTH_COAST)).toMatchObject({ kind: "coast", ok: true });
    const people = [commander, ...foot];
    /** Each body's pose on the hull (ship-relative, so the anchoring itself does not count). */
    const onHull = () => {
      const ship = simulation.shipFrames().find(entry => entry.id === shipId)!, cosine = Math.cos(ship.yaw), sine = Math.sin(ship.yaw);
      const local = (body: { x: number; z: number }, yaw: number) => {
        const dx = body.x - ship.x, dz = body.z - ship.z;
        return { x: dx * cosine - dz * sine, yaw: Math.atan2(Math.sin(yaw - ship.yaw), Math.cos(yaw - ship.yaw)),
          z: dx * sine + dz * cosine };
      };
      const frame = horseFrameOf(simulation, horse)!;
      return [...people.map(uid => local(actorOf(simulation, uid), actorOf(simulation, uid).yaw)),
        local(frame, frame.heading)];
    };
    let before = onHull();
    const started = () => actorOf(simulation, commander).phase === "adventureAboard";
    // The hull itself never jumps or snaps round on its way onto the anchorage (no stall snap).
    const hull = () => simulation.shipFrames().find(entry => entry.id === shipId)!;
    let last = hull(), largestStep = 0, largestTurn = 0, reloadedGliding = false;
    const gliding = () => simulation.saveState().naval.fleet.ships.find(entry => entry.id === shipId)!
      .troopMission?.glide !== undefined;
    expect(advanceUntil(simulation, () => {
      if (!reloadedGliding && gliding()) {
        expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
        reloadedGliding = true;
      }
      const now = hull();
      largestStep = Math.max(largestStep, Math.hypot(now.x - last.x, now.z - last.z));
      largestTurn = Math.max(largestTurn, Math.abs(Math.sin(now.yaw - last.yaw)));
      last = now;
      if (started()) return true;
      before = onHull();
      return false;
    }, 30000)).toBe(true);
    expect(largestStep).toBeLessThan(.25);
    expect(largestTurn).toBeLessThan(.1);
    expect(reloadedGliding).toBe(true);
    const after = onHull();
    // The first to go sets off this very tick (one step of his walk); everyone else stands exactly where he stood.
    const walking = [...people.map(uid => actorOf(simulation, uid).action === "walk"), false];
    after.forEach((pose, index) => {
      const moved = Math.hypot(pose.x - before[index]!.x, pose.z - before[index]!.z);
      expect(moved).toBeLessThan(walking[index] ? .15 : .01);
      if (!walking[index]) expect(Math.abs(Math.sin(pose.yaw - before[index]!.yaw))).toBeLessThan(.01);
    });
    expect(walking.filter(Boolean).length).toBeLessThanOrEqual(1);
    // A reload while they wait rebuilds the same deck places.
    expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
    simulation.update(.05);
    const reloaded = onHull();
    let standing = 0;
    people.forEach((uid, index) => {
      const body = actorOf(simulation, uid);
      if (body.phase !== "adventureAboard" || body.mounted || body.action === "walk") return;
      standing++;
      expect(Math.hypot(reloaded[index]!.x - after[index]!.x, reloaded[index]!.z - after[index]!.z))
        .toBeLessThan(1e-3);
    });
    expect(standing).toBeGreaterThan(2);
  }, 240_000);

  it("continues identically from a save taken while the horse is led (deterministic)", () => {
    const fixture = withFieldCommander(EAST_SHORE), { commander, horse, shipId, simulation } = fixture;
    simulation.embarkMilitary([commander], shipId);
    expect(advanceUntil(simulation, () => actorOf(simulation, commander).phase === "navalBoarding", 30000)).toBe(true);
    const saved = structuredClone(simulation.saveState());
    const run = (target: Simulation) => {
      for (let tick = 0; tick < 300; tick++) target.update(.05);
      return [commander, horse].map(uid => {
        const { phase, visible, x, y, yaw, z } = actorOf(target, uid);
        return { phase, visible, x, y, yaw, z };
      });
    };
    const first = run(simulation);
    const twin = withFieldCommander(EAST_SHORE).simulation;
    expect(twin.loadState(structuredClone(saved))).toEqual({ ok: true });
    expect(run(twin)).toEqual(first);
  }, 240_000);
});
