import { describe, expect, it } from "vitest";

import { planBridge } from "../src/shared/settlement/bridge-planning";
import type { MilitaryCombatant } from "../src/shared/settlement/military-combat-rules";
import { corridorPoints } from "../src/shared/settlement/military-long-routes";
import { createMilitaryMovement } from "../src/shared/settlement/military-movement";
import { navigationJournalWork, resetNavigationJournalWork } from "../src/shared/settlement/navigation-change-journal";
import { ROAD_GRID_STEP, type RoadPoint, type RoadSegment } from "../src/shared/settlement/road-types";
import type { SettlementActor, SettlementContext, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { bridgeRules, paintAngledRiver } from "./helpers/bridge-world";
import { createTrafficWorld } from "./helpers/traffic-scenario";
import { walledContext } from "./helpers/walled-world";

const movementOf = (context: SettlementContext, states = new Map<number, MilitaryCombatant>()) =>
  createMilitaryMovement(context, { stateOf: uid => states.get(uid) });
/** Two soldiers west of the wall ordered to the far side of the gate. */
const WEST: readonly SettlementPoint[] = [{ x: 8.5, z: 40.5 }, { x: 8.5, z: 38.5 }];
const EAST_GOAL: SettlementPoint = { x: 40.5, z: 10.5 };

describe("V08 group order acceptance on the shared flow field (D-V3)", () => {
  it("proves whole-tile reachability per member with one flood per kind of ground", () => {
    const movement = movementOf(walledContext());
    resetNavigationJournalWork();
    const proof = movement.prove(WEST, EAST_GOAL);
    expect(proof).not.toBeNull();
    expect(WEST.map(start => proof!.reaches(start, false))).toEqual([true, true]);
    expect(navigationJournalWork.fieldBuilds).toBe(1);
  });

  it("rejects members walled off from the destination and leaves single soldiers and short trips to A*", () => {
    const movement = movementOf(walledContext(false));
    const proof = movement.prove(WEST, EAST_GOAL);
    expect(proof!.reaches(WEST[0]!, false)).toBe(false);
    expect(proof!.reaches({ x: 30.5, z: 20.5 }, false)).toBe(true);
    expect(movement.prove([WEST[0]!], EAST_GOAL)).toBeNull();
    expect(movement.prove(WEST, { x: 10.5, z: 36.5 })).toBeNull();
  });

  it("lets the joined group walk the proof's field instead of flooding again", () => {
    const states = new Map<number, MilitaryCombatant>(), movement = movementOf(walledContext(), states);
    resetNavigationJournalWork();
    const proof = movement.prove(WEST, EAST_GOAL)!;
    expect(proof.reaches(WEST[0]!, false)).toBe(true);
    expect(movement.join(WEST.map((start, index) => ({ start, uid: index + 1 })), EAST_GOAL, 1, proof.bounds)).toBe(true);
    const actor = { mounted: false, path: [], pathIndex: 0, uid: 1, x: 8.5, z: 40.5 } as unknown as SettlementActor;
    const state = { destination: { ...EAST_GOAL }, routeAge: 0 } as MilitaryCombatant;
    states.set(1, state);
    expect(movement.plan(actor, state, EAST_GOAL)).toBe(true);
    expect(movement.ownerOf(1)).toBe("flow");
    expect(actor.path).toHaveLength(1);
    expect(navigationJournalWork).toMatchObject({ fieldBuilds: 1, fieldShares: 1 });
  });
});

const RIVER = { angleDegrees: 55, centre: { x: 16, z: 16 }, halfWidth: 1.5 };
/** Straight axis road of half-cell edges along x, from `start` for `cells` cells in `direction`. */
const xRoad = (start: RoadPoint, cells: number, direction: -1 | 1): RoadSegment[] =>
  Array.from({ length: cells * 2 }, (_, index) => {
    const from = { x: start.x + direction * index * ROAD_GRID_STEP, z: start.z };
    return { end: { x: from.x + direction * ROAD_GRID_STEP, z: from.z }, start: from, tier: "stone" };
  });
/** A 32² traffic world cut by an angled river, with a planned wooden bridge and its shore roads. */
const riverScene = () => {
  const scene = createTrafficWorld(32);
  const world = scene.world as unknown as Parameters<typeof paintAngledRiver>[0];
  Object.assign(world, { riverDistance: new Float32Array(33 * 33), waterDepth: new Float32Array(33 * 33) });
  paintAngledRiver(world, RIVER);
  const result = planBridge({ id: 3, kind: "wood", pointer: RIVER.centre, rules: bridgeRules(world as never),
    world: world as never });
  if (!result.ok) throw new Error(result.reason);
  const [west, east] = [result.plan.start, result.plan.end].sort((a, b) => a.x - b.x) as [RoadPoint, RoadPoint];
  return { east, scene, segments: [...xRoad(west, 5, -1), ...result.plan.segments, ...xRoad(east, 5, 1)], west };
};

describe("group orders across completed bridge decks (B08 finding)", () => {
  it("accepts a group order across the river only once the deck is complete, and routes the corridor over it", () => {
    const { east, scene, segments, west } = riverScene(), { context, world } = scene;
    const starts = [{ x: west.x - 6, z: west.z - 1 }, { x: west.x - 6, z: west.z + 1 }];
    const goal = { x: east.x + 6, z: east.z }, movement = movementOf(context);
    expect(movement.prove(starts, goal)!.reaches(starts[0]!, false)).toBe(false);
    expect(scene.roads.replaceSegments(segments)).toBe(true);
    // Bridge completion bumps the build revision in the game; the navigation caches look again.
    world.buildRevision = (world.buildRevision ?? 0) + 1;
    expect(movement.prove(starts, goal)!.reaches(starts[0]!, false)).toBe(true);
    const corridor = corridorPoints(context, starts[0]!, goal);
    expect(corridor).not.toBeNull();
    const overWater = corridor!.some(point => world.walkCost[Math.floor(point.z) * 32 + Math.floor(point.x)] === 0);
    expect(overWater).toBe(true);
  });
});
