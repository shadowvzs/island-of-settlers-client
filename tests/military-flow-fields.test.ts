import { describe, expect, it } from "vitest";

import { buildFlowField, flowBounds, flowWaypoint } from "../src/shared/settlement/military-flow-field";
import { navigationJournalWork, resetNavigationJournalWork } from "../src/shared/settlement/navigation-change-journal";
import { resetTrafficWork, trafficWork } from "../src/shared/settlement/settlement-traffic-counters";
import type { SettlementPoint } from "../src/shared/settlement/settlement-types";
import { runMotionScenario } from "../tools/bench/military-motion-metrics";
import { crossingScenario, fieldBattleScenario, gateScenario, siegeScenario } from "../tools/bench/military-motion-scenarios";
import { walledContext } from "./helpers/walled-world";

describe("military flow fields", () => {
  it("routes every tile of the field round the wall and through the gate", () => {
    const context = walledContext(), goal = { x: 40.5, z: 10.5 }, start = { x: 8.5, z: 40.5 };
    const field = buildFlowField(context, goal, false, flowBounds(context, [start, goal]));
    let at: SettlementPoint = start;
    const visited: SettlementPoint[] = [start];
    for (let step = 0; step < 40 && Math.hypot(at.x - goal.x, at.z - goal.z) > .01; step++) {
      at = flowWaypoint(context, field, at)!;
      visited.push(at);
    }
    expect(at).toEqual(goal);
    // Where the route crosses the wall line it passes through the gate.
    const crossings = visited.slice(1).flatMap((point, index) => {
      const from = visited[index]!;
      if ((from.x - 24.5) * (point.x - 24.5) > 0) return [];
      return [from.z + (point.z - from.z) * (24.5 - from.x) / (point.x - from.x)];
    });
    expect(crossings.length).toBe(1);
    expect(crossings[0]).toBeGreaterThanOrEqual(22);
    expect(crossings[0]).toBeLessThan(26);
  });

  it("marks ground walled off from the target as off the field", () => {
    const context = walledContext(), world = context.options.world;
    for (let z = 22; z <= 25; z++) for (const x of [24, 25]) world.walkCost[z * world.cellsX + x] = 0;
    const goal = { x: 40.5, z: 10.5 };
    const field = buildFlowField(context, goal, false, flowBounds(context, [{ x: 8.5, z: 40.5 }, goal]));
    expect(flowWaypoint(context, field, { x: 8.5, z: 40.5 })).toBeNull();
  });
});

describe("flow-field scenarios", () => {
  it("accepts the gate march on the shared field: no ground search per member, one flood per ground (V08)", () => {
    const scenario = gateScenario(24, 10), soldiers = () => scenario.simulation.frames()
      .filter(actor => actor.job === "Soldier").map(actor => `${actor.x},${actor.z}`);
    resetTrafficWork();
    resetNavigationJournalWork();
    scenario.start();
    expect(trafficWork.groundSearches).toBe(0);
    const before = soldiers();
    // The large order is paced one member per tick, each proved on the group's two fields (foot,
    // mounted) instead of its own search; by now every member has been proved and walks.
    for (let tick = 0; tick < 40; tick++) scenario.simulation.update(0.05);
    const moved = soldiers().filter((position, index) => position !== before[index]).length;
    expect(moved).toBe(24);
    expect(trafficWork.groundSearches).toBe(0);
    expect(navigationJournalWork.fieldBuilds).toBe(2);
  });
  it("replays battles deterministically", () => {
    const run = () => {
      const scenario = fieldBattleScenario(12, 25);
      runMotionScenario(scenario);
      return scenario.simulation.frames().filter(actor => actor.job === "Soldier")
        .map(actor => `${actor.uid}:${actor.x.toFixed(6)},${actor.z.toFixed(6)}`).join(" ");
    };
    expect(run()).toEqual(run());
  });
  it("files a mixed army through a gate", () => {
    const { metrics } = runMotionScenario(gateScenario(24, 55));
    expect(metrics.arrivalSeconds).not.toBeNull();
    expect(metrics.stuckSeconds).toBeLessThan(4);
  });
  it("besieges a door without a stuck queue", () => {
    const { metrics } = runMotionScenario(siegeScenario(90));
    expect(metrics.firstBlowSeconds).not.toBeNull();
    expect(metrics.stuckSeconds).toBeLessThan(5);
  });
  it("lets crossing columns pass", () => {
    const { metrics } = runMotionScenario(crossingScenario(16, 50));
    expect(metrics.arrivalSeconds).not.toBeNull();
    expect(metrics.contactsPerSecond).toBeLessThan(1);
  });
});
