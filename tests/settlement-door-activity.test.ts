import { expect, it } from "vitest";

import { updateDoorActivity } from "../src/shared/settlement/settlement-door-activity";
import { actorOpensDoor } from "../src/shared/settlement/settlement-entrance";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { settlementWorkCounters } from "../src/shared/settlement/settlement-work-counters";
import type { WorldData } from "../src/shared/world/world-data";

const fixture = (rotation: number) => {
  const context = {
    options: { world: { cellsX: 64, cellsZ: 64, heights: new Float32Array(65 ** 2) } as WorldData },
    nextBuilding: 0, buildings: [], actors: []
  } as unknown as SettlementContext;
  const building = makeBuilding(context, 17, 32, 32, rotation);
  building.construction = 1;
  context.buildings.push(building);
  const actor = {
    ...building.doorThreshold, uid: 0, home: building.uid, building: building.uid,
    phase: "enterRest", visible: true, path: [], pathIndex: 0
  } as unknown as SettlementActor;
  context.actors.push(actor);
  return { context, building, actor };
};

it.each([0, 1, 2, 3])("opens only the intended doorway at a shorter distance, rotation %i", rotation => {
  const { actor, building } = fixture(rotation);
  const forward = { x: Math.sin(rotation * Math.PI / 2), z: Math.cos(rotation * Math.PI / 2) };
  actor.x += forward.x * .44;
  actor.z += forward.z * .44;
  expect(actorOpensDoor(actor, building)).toBe(true);
  actor.x += forward.x * .12;
  actor.z += forward.z * .12;
  expect(actorOpensDoor(actor, building)).toBe(false);
  Object.assign(actor, building.doorThreshold);
  actor.building = building.uid + 1;
  expect(actorOpensDoor(actor, building)).toBe(false);
  actor.building = building.uid;
  actor.phase = "work";
  expect(actorOpensDoor(actor, building)).toBe(false);
  actor.phase = "enterRest";
  actor.x += forward.z * .3;
  actor.z -= forward.x * .3;
  expect(actorOpensDoor(actor, building)).toBe(false);
});

it("ignores remote work-cycle door requests and closes smoothly after actual passage", () => {
  const { actor, building, context } = fixture(0);
  actor.phase = "inside";
  building.door = 1;
  updateDoorActivity(context, .05);
  expect(building.door).toBe(0);
  actor.phase = "assigned";
  actor.visible = true;
  updateDoorActivity(context, .05);
  expect(building.door).toBe(1);
  actor.phase = "inside";
  updateDoorActivity(context, .1);
  expect(building.door).toBeCloseTo(.85);
  updateDoorActivity(context, 1);
  expect(building.door).toBe(0);
});

it("uses a carrier's pickup source door rather than its destination", () => {
  const { actor, building } = fixture(0);
  actor.building = 9;
  actor.phase = "exitLoaded";
  actor.delivery = { source: building.uid, destination: 9, ware: "fish" };
  expect(actorOpensDoor(actor, building)).toBe(true);
  actor.delivery.source = 8;
  expect(actorOpensDoor(actor, building)).toBe(false);
});

it("animates every doorway in a single pass over the actors", () => {
  const { actor, building, context } = fixture(0);
  const others = [1, 2, 3].map((offset) => {
    const other = makeBuilding(context, 17, 32 + offset * 6, 20, 0);
    other.construction = 1;
    other.door = 1;
    context.buildings.push(other);
    return other;
  });
  for (let uid = 1; uid < 12; uid++)
    context.actors.push({ ...actor, uid, phase: "inside", visible: false } as SettlementActor);
  const passer = { ...others[1]!.doorThreshold, uid: 20, home: others[1]!.uid, building: others[1]!.uid,
    phase: "enterRest", visible: true, path: [], pathIndex: 0 } as unknown as SettlementActor;
  context.actors.push(passer);
  updateDoorActivity(context, 0.05);
  expect(settlementWorkCounters(context).doorActivityVisits).toBe(context.actors.length);
  expect([building, ...others].map((entry) => entry.door)).toEqual([1, 0, 1, 0]);
});

it("keeps the door shut for invisible departures waiting inside", () => {
  const { actor, building, context } = fixture(0);
  actor.phase = "assigned";
  actor.visible = false;
  updateDoorActivity(context, 1);
  expect(building.door).toBe(0);
});

it("a distant stale entry never reserves a door against local departures", async () => {
  const { canLeaveDoor } = await import("../src/shared/settlement/settlement-entrance");
  const { actor, building, context } = fixture(0);
  actor.x += 20;
  const departing = { ...actor, uid: 1, phase: "assigned", visible: false, ...building.doorThreshold };
  context.actors.push(departing);
  expect(canLeaveDoor(context, departing)).toBe(true);
  Object.assign(actor, building.workerApproach);
  expect(canLeaveDoor(context, departing)).toBe(false);
});
