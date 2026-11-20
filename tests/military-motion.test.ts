import { describe, expect, it } from "vitest";

import { MELEE_PLACES } from "../src/shared/settlement/military-engagement";
import type { WorldData } from "../src/shared/world/world-data";
import {
  createBalanceSimulation, deployForce, garrisonPlan, placeHostileSite, spawnAround
} from "../tools/bench/garrison-balance-harness";
import { runMotionScenario } from "../tools/bench/military-motion-metrics";
import {
  crossingScenario, fieldBattleScenario, gateScenario, headOnScenario, siegeScenario
} from "../tools/bench/military-motion-scenarios";

/**
 * Military motion (docs/archive/dated/military-motion-2026-10-13.md): scenario metrics with thresholds, from the
 * measured before/after table (thresholds sit between the two, with room for small tuning changes).
 */
describe("military motion scenarios", () => {
  it("passes opposite streams without jamming (keep right, riders included)", () => {
    const scenario = headOnScenario(12, 45);
    const { metrics } = runMotionScenario(scenario);
    // The stuck ladder's last rung (a soldier making no headway for 10 s) never fires.
    expect(scenario.simulation.navigationDiagnostics().military.warnings).toBe(0);
    expect(metrics.arrivalSeconds).not.toBeNull();
    expect(metrics.stuckSeconds).toBeLessThan(2);
    expect(metrics.bumpStopsPerSecond).toBeLessThan(1);
    expect(metrics.aboutFaces).toBeLessThanOrEqual(3);
  }, 120_000);

  it("lets crossing columns pass one after the other, each keeping its shape", () => {
    const scenario = crossingScenario(16, 45);
    const { metrics } = runMotionScenario(scenario);
    // The stuck ladder's last rung (a soldier making no headway for 10 s) never fires.
    expect(scenario.simulation.navigationDiagnostics().military.warnings).toBe(0);
    expect(metrics.arrivalSeconds).not.toBeNull();
    // The blocks no longer thread through each other (crossing priority, 2026-10-15).
    expect(metrics.contactsPerSecond).toBeLessThan(.3);
    // The waiting block's members closing up into their slots count as a few stalled seconds.
    expect(metrics.stuckSeconds).toBeLessThan(4);
  }, 120_000);

  it("files an army through a gate without pressing into the wall", () => {
    const scenario = gateScenario(24, 50);
    const { metrics } = runMotionScenario(scenario);
    // The stuck ladder's last rung (a soldier making no headway for 10 s) never fires.
    expect(scenario.simulation.navigationDiagnostics().military.warnings).toBe(0);
    expect(metrics.arrivalSeconds).not.toBeNull();
    expect(metrics.stuckSeconds).toBeLessThan(3);
    expect(metrics.aboutFaces).toBeLessThanOrEqual(8);
    // The shipped army (flow fields, 2026-10-19; formations before) files through the gate: longer
    // ways than single soldiers' A* routes (1.25), but no pressing and no turning round.
    expect(metrics.pathRatioP90).toBeLessThan(1.8);
  }, 120_000);

  it("forms a front with at most three attackers per foe and staggered blows", () => {
    const scenario = fieldBattleScenario(24, 45);
    const { metrics } = runMotionScenario(scenario);
    // The stuck ladder's last rung (a soldier making no headway for 10 s) never fires.
    expect(scenario.simulation.navigationDiagnostics().military.warnings).toBe(0);
    expect(metrics.firstBlowSeconds).not.toBeNull();
    // Three places, plus the soldier the foe itself fights: it is always admitted (military-melee.ts `approach`).
    expect(metrics.attackersMax).toBeLessThanOrEqual(MELEE_PLACES + 1);
    expect(metrics.crowdedTargets).toBeLessThan(.1);
    expect(metrics.overlapPerSecond).toBeLessThan(.05);
    expect(metrics.syncedBlows).toBeLessThan(.27);
  }, 120_000);

  it("keeps a siege queue still: no walking round each other at the door", () => {
    const { metrics } = runMotionScenario(siegeScenario(70));
    expect(metrics.firstBlowSeconds).not.toBeNull();
    expect(metrics.aboutFaces).toBeLessThan(120);
    expect(metrics.pathRatio).toBeLessThan(1.6);
    expect(metrics.stuckSeconds).toBeLessThan(10);
  }, 180_000);

  it("is deterministic: the same scenario ends with every soldier in the same place", () => {
    const positions = () => {
      const scenario = headOnScenario(8, 20);
      runMotionScenario(scenario);
      return scenario.simulation.frames().filter(actor => actor.job === "Soldier")
        .map(actor => `${actor.uid}:${actor.x.toFixed(6)},${actor.z.toFixed(6)}`);
    };
    expect(positions()).toEqual(positions());
  }, 120_000);
});

/** A town street two tiles wide between blocks of houses (walls of unwalkable cells). */
const cramp = (world: WorldData) => {
  for (let z = 20; z < 34; z++) for (let x = 20; x < 34; x++)
    if (x !== 26 && x !== 27) world.walkCost[z * world.cellsX + x] = 0;
};

describe("military motion: older owner reports", () => {
  it("leads an isolated city rider's horse out of a narrow street, then rides on", () => {
    const simulation = createBalanceSimulation(64, 2, { x: 6.5, z: 6.5 }, cramp);
    const rider = spawnAround(simulation, { x: 27, z: 40 }, "cavalry", 0, 1);
    const saved = simulation.saveState();
    // Caught in the middle of the street, where a horse has no room (e.g. houses built round it).
    Object.assign(saved.actors.find(actor => actor.uid === rider)!, { path: [], pathIndex: 0, x: 27, z: 27 });
    expect(simulation.loadState(saved).ok).toBe(true);
    expect(simulation.commandMilitaryOpponent([rider], { x: 27, z: 50 }, 1, "move")).toBe(true);
    for (let tick = 0; tick < 60 * 20; tick++) simulation.update(.05);
    const body = simulation.frames().find(actor => actor.uid === rider)!;
    const state = simulation.militarySoldiers().find(soldier => soldier.actor === rider)!.combat!;
    expect(state.destination).toBeUndefined();
    expect(Math.hypot(body.x - 27, body.z - 50)).toBeLessThan(1.5);
    expect(body.mounted).toBe(true);
  }, 60_000);

  it("turns archers to their next foe between volleys instead of snapping round", () => {
    const simulation = createBalanceSimulation(48, 4, { x: 6.5, z: 6.5 });
    const archer = simulation.spawnMilitaryOpponent({ x: 24, z: 24 }, "archer", 0, 1)!;
    const east = simulation.spawnMilitaryOpponent({ x: 30, z: 24 }, "shield", 0, 2)!;
    const west = simulation.spawnMilitaryOpponent({ x: 18, z: 24.5 }, "shield", 0, 2)!;
    const body = () => simulation.frames().find(actor => actor.uid === archer)!;
    const pin = () => {
      for (const id of [archer, east, west]) {
        const actor = simulation.frames().find(entry => entry.uid === id);
        if (actor) { actor.path = []; actor.pathIndex = 0; }
      }
    };
    let largestTurn = 0, released = 0, misaimed = 0, last = body().yaw;
    const known = new Set<number>();
    for (let tick = 0; tick < 30 * 20; tick++) {
      pin(); simulation.update(.05);
      const actor = simulation.frames().find(entry => entry.uid === archer);
      if (!actor) break;
      largestTurn = Math.max(largestTurn, Math.abs(Math.atan2(Math.sin(actor.yaw - last), Math.cos(actor.yaw - last))));
      last = actor.yaw;
      for (const arrow of simulation.militaryArrows()) {
        if (arrow.shooter !== archer || known.has(arrow.id)) continue;
        known.add(arrow.id); released++;
        const foe = simulation.militarySoldiers().find(soldier => soldier.actor === archer)?.combat?.target;
        const target = simulation.frames().find(entry => entry.uid === foe);
        if (!target) continue;
        const heading = Math.atan2(target.x - actor.x, target.z - actor.z);
        if (Math.abs(Math.atan2(Math.sin(heading - actor.yaw), Math.cos(heading - actor.yaw))) > .4) misaimed++;
      }
    }
    expect(released).toBeGreaterThan(2);
    expect(misaimed).toBe(0);
    // Turning pace: about 9 radians per second (plus the last few degrees of aim), never a half-turn.
    expect(largestTurn).toBeLessThan(.9);
  }, 60_000);

  it("hands a captured building wholly to its captor", () => {
    const simulation = createBalanceSimulation(64, 6, { x: 6.5, z: 6.5 });
    const site = placeHostileSite(simulation, 2, 40, 40);
    const plan = garrisonPlan(2, [0]);
    const guards = plan.troops.map((type, index) => spawnAround(simulation, site.access, type, plan.ranks[index]));
    expect(simulation.registerMilitaryGarrison(site.uid, guards, 1, 20)).toBe(true);
    const saved = simulation.saveState();
    for (const soldier of saved.military!.soldiers) if (soldier.combat?.faction === 1) soldier.combat!.hp = 2;
    expect(simulation.loadState(saved).ok).toBe(true);
    deployForce(simulation, { heavy: 3, ranks: [1], shield: 5 }, { x: 30, z: 30 });
    const ours = simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0)
      .map(soldier => soldier.actor);
    expect(simulation.siegeMilitary(ours, site.uid)).toBe(true);
    // Loading a save replaces the building objects: look the site up afresh.
    const faction = () => simulation.buildings().find(building => building.uid === site.uid)?.militaryFaction;
    for (let second = 0; second < 240 && faction() !== 0; second++) simulation.update(1);
    expect(faction()).toBe(0);
    expect(simulation.militaryDoors().find(door => door.building === site.uid)?.faction).toBe(0);
    const holders = simulation.militarySoldiers().filter(soldier => soldier.building === site.uid);
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.every(soldier => soldier.stationed && (soldier.combat?.faction ?? 0) === 0)).toBe(true);
    expect(simulation.militarySoldiers().some(soldier => (soldier.combat?.faction ?? 0) > 0 &&
      (soldier.building === site.uid || soldier.combat?.siege === site.uid))).toBe(false);
    expect(simulation.ownsTerritory(site.access)).toBe(true);
    // The enemy cannot simply man it again.
    const late = spawnAround(simulation, { x: 50, z: 50 }, "shield", 0, 1);
    expect(simulation.registerMilitaryGarrison(site.uid, [late], 1)).toBe(false);
    expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
    expect(simulation.buildings().find(building => building.uid === site.uid)?.militaryFaction).toBe(0);
  }, 120_000);
});
