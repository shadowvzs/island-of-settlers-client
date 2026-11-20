import { expect, it } from "vitest";

import {
  isGroundSegmentClear,
  isNavigationClear} from "../src/shared/settlement/settlement-navigation";
import { moveActor } from "../src/shared/settlement/settlement-paths";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { PROP, type WorldData } from "../src/shared/world/world-data";
const fixture = () => {
  const size = 24,
    world = {
      cellsX: size,
      cellsZ: size,
      heights: new Float32Array((size + 1) ** 2),
      walkCost: new Uint8Array(size ** 2).fill(10),
      props: {
        count: 0,
        types: new Uint8Array(2),
        x: new Float32Array(2),
        z: new Float32Array(2),
        scale: new Float32Array(2).fill(1)
      },
      buildRevision: 0
    } as unknown as WorldData;
  const actor = {
    uid: 0,
    x: 4,
    y: 0,
    z: 8,
    yaw: 0,
    visible: true,
    job: "Woodcutter",
    action: "walk",
    ware: null,
    phase: "outbound",
    building: 1,
    home: 0,
    path: [
      { x: 12, z: 8 },
      { x: 12, z: 12 }
    ],
    pathIndex: 0,
    timer: 0,
    animationTime: 0
  } as SettlementActor;
  const context = {
    options: {
      world,
      roads: { route: () => null, addRoad: () => false, upgradeRoad: () => false }
    },
    actors: [actor],
    buildings: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set(),
    resourceAmounts: new Map()
  } as unknown as SettlementContext;
  const plant = (x: number, z: number) => {
    world.props.count++;
    world.props.types[world.props.count - 1] = PROP.broadleafTree;
    world.props.x[world.props.count - 1] = x;
    world.props.z[world.props.count - 1] = z;
    world.buildRevision!++;
  };
  return { world, actor, context, plant };
};
it("replans a stale walking segment around a newly planted trunk and retains the final route", () => {
  const { actor, context, plant } = fixture();
  for (let i = 0; i < 25; i++) moveActor(context, actor, 0.05);
  plant(8, 8);
  expect(isGroundSegmentClear(context, actor, { x: 12, z: 8 })).toBe(false);
  let finished = false,
    sideways = false;
  for (let i = 0; i < 600 && !finished; i++) {
    const previous = { x: actor.x, z: actor.z };
    finished = moveActor(context, actor, 0.05);
    expect(isNavigationClear(context, actor)).toBe(true);
    expect(Math.hypot(actor.x - previous.x, actor.z - previous.z)).toBeLessThanOrEqual(0.045001);
    sideways ||= Math.abs(actor.z - 8) > 0.3 && actor.x < 10;
  }
  expect(sideways).toBe(true);
  expect(finished).toBe(true);
  expect(actor.x).toBeCloseTo(12);
  expect(actor.z).toBeCloseTo(12);
});
it("escapes a newly grown trunk continuously instead of permanently trapping or teleporting the worker", () => {
  const { actor, context, plant } = fixture();
  actor.x = 8;
  plant(8, 8);
  expect(isNavigationClear(context, actor)).toBe(false);
  let lastDistance = 0,
    finished = false;
  for (let i = 0; i < 600 && !finished; i++) {
    const previous = { x: actor.x, z: actor.z };
    finished = moveActor(context, actor, 0.05);
    const distance = Math.hypot(actor.x - 8, actor.z - 8);
    if (lastDistance < 0.3) expect(distance).toBeGreaterThanOrEqual(lastDistance);
    expect(Math.hypot(actor.x - previous.x, actor.z - previous.z)).toBeLessThanOrEqual(0.045001);
    lastDistance = distance;
  }
  expect(finished).toBe(true);
  expect(isNavigationClear(context, actor)).toBe(true);
});
it("does not permit an approaching worker to use the escape exemption to enter a trunk", () => {
  const { actor, context, plant } = fixture();
  plant(8, 8);
  actor.x = 7.6;
  actor.path = [{ x: 8, z: 8 }];
  for (let i = 0; i < 60; i++) moveActor(context, actor, 0.05);
  expect(Math.hypot(actor.x - 8, actor.z - 8)).toBeGreaterThanOrEqual(0.3);
  expect(isNavigationClear(context, actor)).toBe(true);
});

it.each([['Woodcutter','logs'],['Stonemason','stone'],['Fisher','fish']])(
  'returns the loaded %s around mature standing trees on an obstructed off-road route', (job,ware)=>{
    const {actor,context,plant}=fixture();plant(8,8);plant(9,8.5);
    actor.job=job;actor.ware=ware;actor.action='carry';actor.phase='outputWalk';
    let finished=false;
    for(let step=0;step<800 && !finished;step++){
      finished=moveActor(context,actor,.05);
      expect(isNavigationClear(context,actor)).toBe(true);
      expect(actor.ware).toBe(ware);
    }
    expect(finished).toBe(true);expect(actor.x).toBeCloseTo(12);expect(actor.z).toBeCloseTo(12);
  }
);
