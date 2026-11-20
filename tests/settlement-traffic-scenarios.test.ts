import { describe, expect, it } from "vitest";

import { movementOutcome } from "../src/shared/settlement/settlement-navigation-recovery";
import { ownsStockCourt } from "../src/shared/settlement/settlement-stock-traffic";
import { runSaveLoadVariant, runTraffic, runTwice, type ScenarioBuild } from "./helpers/traffic-scenario";
import {
  corridorTwoByTwo, corridorWithIdler, doorstepSquatter, fourWay, gate, headOn, idleAtWaypoint, idleBesideRoad,
  perpendicularStreams, platoons, sharedGoal, star, stockCourtWaiters
} from "./helpers/traffic-scenario-fixtures";

const run = (build: () => ScenarioBuild, seconds: number) => {
  const scenario = build();
  return { metrics: runTraffic(scenario.scene.context, scenario.movers, seconds, { scene: scenario.scene }),
    scenario };
};

describe("simple crowd flows keep their pinned baselines", () => {
  // Ceilings pinned before any crowd-motion behaviour change; later commits may only lower them.
  it.each([
    ["head-on", headOn, 20, 0, 0],
    ["4-way crossing", fourWay, 20, 0, 0],
    ["6v6 platoons", platoons, 40, 2, 0],
    ["5x5 perpendicular streams", perpendicularStreams, 40, 0, 0],
    ["corridor 2v2", corridorTwoByTwo, 60, 2, 0],
    ["16-unit star", star(16), 60, 10, 0]
  ] as const)("%s completes without overlaps or stalls", (_name, build, seconds, reversals, stillStride) => {
    const { metrics, scenario } = run(build, seconds);
    expect(metrics.completed).toBe(scenario.movers.length);
    expect(metrics.overlaps).toBe(0);
    expect(metrics.noProgressViolations).toBe(0);
    expect(metrics.headingReversals).toBeLessThanOrEqual(reversals);
    expect(metrics.walkPoseWhileStill).toBeLessThanOrEqual(stillStride + 1e-9);
  });
});

it("runs the same gate jam identically twice", () => {
  const [first, second] = runTwice(gate(6), 30);
  expect(first).toBe(second);
});

const walkedRatio = (metrics: ReturnType<typeof runTraffic>) => Math.max(...metrics.walked.map((walked, index) =>
  walked / Math.max(.01, walked - metrics.pathExcess[index]!)));

describe("crowd motion: no orbits around units standing on a goal", () => {
  it("passes an idle unit standing beside its next waypoint without sidestepping around it", () => {
    const { metrics } = run(idleAtWaypoint, 20);
    expect(metrics.completed).toBe(1);
    expect(walkedRatio(metrics)).toBeLessThanOrEqual(1.15);
    expect(metrics.noProgressViolations).toBe(0);
  });
  it("two platoons sharing one goal per side all settle instead of orbiting", () => {
    const { metrics, scenario } = run(sharedGoal(), 30);
    expect(metrics.completed).toBe(scenario.movers.length);
    expect(walkedRatio(metrics)).toBeLessThanOrEqual(1.3);
    expect(metrics.noProgressViolations).toBe(0);
  });
});

describe("crowd motion: passers walk around crews instead of shoving them", () => {
  it.each([
    ["Builder", "builderWork"], ["Leveler", "levelWaiting"], ["Woodcutter", "workerRestWait"],
    ["Woodcutter", "inputFetchBlocked"], ["Builder", "construct"]
  ] as const)("a %s in %s beside the road is never displaced", (job, phase) => {
    const { metrics } = run(idleBesideRoad(job, phase), 30);
    expect(metrics.completed).toBe(1);
    expect(metrics.bystanderDisplacement).toBe(0);
    expect(metrics.headingReversals).toBe(0);
  });
  it("a carrier still passes an idle carrier standing in a one-tile road corridor", () => {
    const { metrics } = run(corridorWithIdler("Carrier", "home"), 30);
    expect(metrics.completed).toBe(1);
    expect(metrics.noProgressViolations).toBe(0);
  });
});

describe("crowd motion: waiting, facing and pose", () => {
  it("a 6v6 gate jam completes with short pauses, few reversals and no frozen strides", () => {
    const { metrics, scenario } = run(gate(6), 60);
    expect(metrics.completed).toBe(scenario.movers.length);
    expect(metrics.headingReversals).toBeLessThanOrEqual(14);
    expect(metrics.walkPoseWhileStill).toBeLessThanOrEqual(1);
    expect(metrics.yieldWait).toBeLessThanOrEqual(1.2);
    expect(metrics.waitingFacedSamples / metrics.waitingFacingSamples).toBeGreaterThanOrEqual(.8);
  });
  it("the 16-unit star waits at most a few ticks per unit and faces where it is going", () => {
    const { metrics } = run(star(16), 60);
    expect(metrics.yieldWait / 16).toBeLessThanOrEqual(6 * .05);
    expect(metrics.waitingFacedSamples / metrics.waitingFacingSamples).toBeGreaterThanOrEqual(.9);
  });
  it("a hidden worker behind a squatter on its threshold gets out within two seconds", () => {
    const { hidden, scenario } = doorstepSquatter();
    const outcomes = new Set<string>();
    runTraffic(scenario.scene.context, scenario.movers, 2, {
      afterTick: () => outcomes.add(movementOutcome(hidden)), scene: scenario.scene
    });
    expect(outcomes.has("door-queue")).toBe(true);
    expect(hidden.visible).toBe(true);
  });
});

it("continues a gate jam identically after a save and load", () => {
  const { continued, loaded, saved } = runSaveLoadVariant(gate(6), 6, 30);
  expect(saved.some(actor => actor.queueKind)).toBe(true);
  expect(loaded.metrics.completed).toBe(continued.metrics.completed);
  expect(loaded.hash).toBe(continued.hash);
});

describe("reservations: stock court waiting slots", () => {
  const leaveCourt = (owner: ReturnType<ReturnType<typeof stockCourtWaiters>>["owner"]) => {
    Object.assign(owner, { action: "walk", path: [{ x: 14, z: 13.5 }, { x: 18, z: 16 }], pathIndex: 0, phase: "home" });
  };
  it("a waiter walks to one slot, stays there idle facing the contact, and enters once the owner leaves", () => {
    const { owner, scenario } = stockCourtWaiters(1)();
    const waiter = scenario.movers[0]!;
    const outcomes: string[] = [];
    const metrics = runTraffic(scenario.scene.context, scenario.movers, 30, {
      afterTick: () => outcomes.push(movementOutcome(waiter)), scene: scenario.scene
    });
    expect(metrics.waitingWalked).toBeLessThan(1);
    expect(metrics.waiterDrift).toBeLessThan(.3);
    expect(outcomes.slice(-400).filter(outcome => outcome === "stock-wait").length / 400).toBeGreaterThanOrEqual(.9);
    expect(metrics.waitingFacedSamples / metrics.waitingFacingSamples).toBeGreaterThanOrEqual(.9);
    leaveCourt(owner);
    // BAL-01: carriers walk 30% slower, so the two trips need 14 s instead of 10.
    const after = runTraffic(scenario.scene.context, [...scenario.movers, owner], 14, { scene: scenario.scene });
    expect(after.completed).toBe(2);
  });
  it("three waiters take distinct slots", () => {
    const { scenario } = stockCourtWaiters(3)();
    runTraffic(scenario.scene.context, scenario.movers, 20, { scene: scenario.scene });
    const spots = scenario.movers.map(actor => ({ x: actor.x, z: actor.z }));
    for (let first = 0; first < spots.length; first++) for (let second = first + 1; second < spots.length; second++)
      expect(Math.hypot(spots[first]!.x - spots[second]!.x, spots[first]!.z - spots[second]!.z)).toBeGreaterThan(.3);
    expect(scenario.movers.every(actor => movementOutcome(actor) === "stock-wait")).toBe(true);
  });
  it.each([0, 1, 2, 3])("an owner leaving through its waiters (exit side %i) gets out and they all enter one by one", side => {
    const { owner, scenario } = stockCourtWaiters(3)();
    runTraffic(scenario.scene.context, scenario.movers, 10, { scene: scenario.scene });
    const exits = [{ x: 14, z: 13.5 }, { x: 11.4, z: 14 }, { x: 15, z: 10.2 }, { x: 8, z: 11.5 }];
    Object.assign(owner, { action: "walk", path: [exits[side]!, { x: 18, z: 18 }], pathIndex: 0, phase: "home" });
    const admitted: number[] = [];
    // A waiter reaching the contact hands over its ware and leaves the court at once.
    const handOver = () => {
      for (const waiter of scenario.movers) {
        if (!waiter.visible || waiter.pathIndex < waiter.path.length) continue;
        admitted.push(waiter.uid);
        Object.assign(waiter, { phase: "inside", visible: false });
      }
    };
    const metrics = runTraffic(scenario.scene.context, [owner, ...scenario.movers], 30,
      { afterTick: handOver, scene: scenario.scene });
    expect(metrics.completed).toBe(4);
    expect(ownsStockCourt(scenario.scene.context, owner)).toBe(false);
    expect([...admitted].sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });
});
