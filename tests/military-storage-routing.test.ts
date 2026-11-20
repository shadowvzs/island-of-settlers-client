import { expect, it } from "vitest";

import { withMilitaryFootCorridorBatch } from "../src/shared/settlement/military-long-routes";
import { militaryGroundPath, nearestMilitaryStorage } from "../src/shared/settlement/military-routing";
import { isGroundSegmentClear } from "../src/shared/settlement/settlement-navigation";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

it.each([29, 39])("finds a friendly island storage of type %i without an HQ or UID-zero assumption", typeId => {
  const scene = createTrafficWorld(96), { context } = scene;
  context.nextBuilding = 41; context.playerNation = "chinese";
  const home = makeBuilding(context, typeId, 12.5, 12.5, 0);
  home.construction = 1;
  const enemy = makeBuilding(context, 29, 74.5, 30.5, 0);
  enemy.construction = 1; enemy.militaryFaction = 1;
  const unfinished = makeBuilding(context, 29, 67.5, 29.5, 0);
  unfinished.construction = 0;
  context.buildings.push(home, enemy, unfinished);
  const actor = addActor(scene, { uid: 1407, job: "Soldier", phase: "militaryField", x: 70, z: 20 });
  const choice = nearestMilitaryStorage(context, actor);
  expect(choice?.home.uid).toBe(home.uid);
  expect(home.uid).not.toBe(0);
  let previous = { x: actor.x, z: actor.z };
  for (const point of choice!.path) {
    expect(isGroundSegmentClear(context, previous, point)).toBe(true);
    previous = point;
  }
  expect(choice!.path.at(-1)).toEqual(home.access);
  expect(nearestMilitaryStorage(context, actor, enemy.uid)).toBeUndefined();
  expect(nearestMilitaryStorage(context, actor, unfinished.uid)).toBeUndefined();
});

it("keeps explicit storage choice and cheapest reachable path cost ahead of storage array order", () => {
  const scene = createTrafficWorld(64), { context } = scene;
  context.nextBuilding = 52;
  const far = makeBuilding(context, 29, 10.5, 10.5, 0), near = makeBuilding(context, 29, 35.5, 36.5, 0);
  far.construction = 1; near.construction = 1;
  context.buildings.push(far, near);
  const actor = addActor(scene, { uid: 17, job: "Soldier", phase: "militaryField", x: 45, z: 45 });
  expect(nearestMilitaryStorage(context, actor)?.home.uid).toBe(near.uid);
  expect(nearestMilitaryStorage(context, actor, far.uid)?.home.uid).toBe(far.uid);
});

it("connects a clear subcell beside a catapult to a coarse military corridor without crossing its walls", () => {
  const scene = createTrafficWorld(96), { context } = scene;
  context.nextBuilding = 7; context.playerNation = "chinese";
  const home = makeBuilding(context, 29, 19.5, 38.5, 0);
  home.construction = 1;
  context.nextBuilding = 40;
  const tower = makeBuilding(context, 16, 52.5, 52.5, 3);
  tower.construction = 1; tower.input = { stone: 2 };
  context.buildings.push(home, tower);
  const actor = addActor(scene, { uid: 1429, job: "Soldier", phase: "militaryField",
    x: 53.94035277499918, z: 53.78090367348567 });
  const choice = nearestMilitaryStorage(context, actor);
  expect(choice?.home.uid).toBe(home.uid);
  let previous = { x: actor.x, z: actor.z };
  for (const point of choice!.path) {
    expect(isGroundSegmentClear(context, previous, point)).toBe(true);
    previous = point;
  }
  expect(actor.x).toBe(53.94035277499918);
  expect(actor.z).toBe(53.78090367348567);
});


it("shares static foot corridor cells without sharing exact start/goal positions or leaking across commands", () => {
  const scene = createTrafficWorld(64), { context } = scene;
  context.nextBuilding = 11;
  const home = makeBuilding(context, 29, 12.5, 12.5, 0);
  home.construction = 1; context.buildings.push(home);
  const queries = [
    { from: { x: 50.1, z: 50.1 }, to: { ...home.access } },
    { from: { x: 50.8, z: 50.2 }, to: { x: home.access.x + .1, z: home.access.z + .1 } }
  ];
  const reference = queries.map(({ from, to }) => militaryGroundPath(context, from, to));
  expect(reference.every(Boolean)).toBe(true);
  const batched = withMilitaryFootCorridorBatch(context, () => queries.map(({ from, to }) => militaryGroundPath(context, from, to)));
  expect(batched).toEqual(reference);
  context.options.world.walkCost.fill(0);
  expect(withMilitaryFootCorridorBatch(context, () => militaryGroundPath(context, queries[0]!.from, queries[0]!.to)))
    .toBeNull();
  context.options.world.walkCost.fill(10);
  expect(withMilitaryFootCorridorBatch(context, () => militaryGroundPath(context, queries[0]!.from, queries[0]!.to)))
    .toEqual(reference[0]);
});

it("chooses a farther storage when the nearer one requires a longer physical detour", () => {
  const scene = createTrafficWorld(96), { context } = scene;
  context.nextBuilding = 20;
  const near = makeBuilding(context, 29, 35.5, 20.5, 0), far = makeBuilding(context, 29, 75.5, 60.5, 0);
  near.construction = 1; far.construction = 1;
  context.buildings.push(near, far);
  for (let z = 0; z < 81; z++) scene.world.walkCost[z * 96 + 40] = 0;
  const actor = addActor(scene, { uid: 5, job: "Soldier", phase: "militaryField", x: 70, z: 20 });
  expect(Math.hypot(actor.x - near.access.x, actor.z - near.access.z))
    .toBeLessThan(Math.hypot(actor.x - far.access.x, actor.z - far.access.z));
  expect(nearestMilitaryStorage(context, actor)?.home.uid).toBe(far.uid);
});

it("skips a blocked closest storage and preserves equal-cost UID ties", () => {
  const scene = createTrafficWorld(96), { context } = scene;
  context.nextBuilding = 20;
  const blocked = makeBuilding(context, 29, 65.5, 20.5, 0), clear = makeBuilding(context, 29, 75.5, 30.5, 0);
  blocked.construction = 1; clear.construction = 1;
  context.buildings.push(blocked, clear);
  scene.world.walkCost[Math.floor(blocked.access.z) * 96 + Math.floor(blocked.access.x)] = 0;
  const actor = addActor(scene, { uid: 5, job: "Soldier", phase: "militaryField", x: 70, z: 20 });
  expect(nearestMilitaryStorage(context, actor)?.home.uid).toBe(clear.uid);

  const other = createTrafficWorld(96);
  other.context.nextBuilding = 41;
  const low = makeBuilding(other.context, 29, 60.5, 46.5, 0), high = makeBuilding(other.context, 29, 39.5, 46.5, 0);
  low.construction = 1; high.construction = 1;
  other.context.buildings.push(high, low);
  const tied = addActor(other, { uid: 7, job: "Soldier", phase: "militaryField", x: 50, z: 50 });
  expect(nearestMilitaryStorage(other.context, tied)?.home.uid).toBe(low.uid);
});

it("retains live mounted staging reservations inside a foot-corridor batch", () => {
  const scene = createTrafficWorld(64), { context } = scene;
  context.nextBuilding = 13;
  const home = makeBuilding(context, 29, 12.5, 12.5, 0);
  home.construction = 1; context.buildings.push(home);
  const actor = addActor(scene, { uid: 100, job: "Soldier", phase: "militaryField", x: 50.5, z: 50.5 });
  actor.mounted = true;
  withMilitaryFootCorridorBatch(context, () => {
    const first = nearestMilitaryStorage(context, actor)!;
    expect(first).toBeDefined();
    const reserving = addActor(scene, { uid: 101, job: "Soldier", phase: "militaryMountedReturn",
      x: 45, z: 45, home: home.uid, path: [first.path.at(-1)!] });
    reserving.mounted = true;
    const second = nearestMilitaryStorage(context, actor)!;
    expect(second.home.uid).toBe(home.uid);
    expect(second.path.at(-1)).not.toEqual(first.path.at(-1));
  });
});
