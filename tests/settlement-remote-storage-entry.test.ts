import { expect, it } from "vitest";

import { canWorkerEnterBuildingPlot } from "../src/app/settlement/island-simulation-hooks";
import { createGameClock } from "../src/shared/settlement/game-clock";
import type { RoadSegment } from "../src/shared/settlement/road-types";
import { distanceToSegment } from "../src/shared/settlement/settlement-geometry";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { beginPersonTrafficTick } from "../src/shared/settlement/settlement-person-index";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { resetTrafficWork, snapshotTrafficWork } from "../src/shared/settlement/settlement-traffic-counters";
import { addActor, createTrafficWorld } from "./helpers/traffic-scenario";

const roadsAlong = (points: { x: number; z: number }[]) => {
  const segments: RoadSegment[] = [];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!, to = points[index]!;
    const count = Math.round(Math.hypot(to.x - from.x, to.z - from.z) / .5);
    for (let step = 0; step < count; step++) segments.push({ tier: "dirt",
      start: { x: from.x + (to.x - from.x) * step / count, z: from.z + (to.z - from.z) * step / count },
      end: { x: from.x + (to.x - from.x) * (step + 1) / count,
        z: from.z + (to.z - from.z) * (step + 1) / count } });
  }
  return [...new Map(segments.map(segment => [
    [`${segment.start.x}:${segment.start.z}`, `${segment.end.x}:${segment.end.z}`].sort().join("/"), segment
  ])).values()];
};
const fixture = () => {
  const scene = createTrafficWorld(32), { context } = scene;
  context.playerNation = "chinese"; context.nextBuilding = 0;
  context.options.canWorkerEnterPlot = (building, point) =>
    canWorkerEnterBuildingPlot(building, point, context.playerNation);
  const source = makeBuilding(context, 39, 9, 8, 0);
  source.construction = 1; source.inventory = { planks: 4 };
  const destination = makeBuilding(context, 39, 24, 23, 0);
  destination.construction = 1; destination.incoming = { planks: 1 };
  context.buildings.push(source, destination);
  const segments = roadsAlong([{ x: 20, z: 20 }, { x: 20, z: source.access.z }, source.access,
    { x: destination.access.x, z: source.access.z }, destination.access]);
  expect(scene.roads.replaceSegments(segments)).toBe(true);
  const unit = addActor(scene, { uid: 11, job: "Carrier", building: destination.uid,
    x: 20, z: 20, phase: "enterPickup", path: [source.workerApproach, source.doorThreshold] });
  unit.delivery = { source: source.uid, destination: destination.uid, ware: "planks", reserved: false };
  return { ...scene, destination, segments, source, unit };
};

it("repairs the remote entrance over existing roads with continuous movement and unchanged cargo ownership", () => {
  const { context, destination, segments, source, unit } = fixture();
  const delivery = unit.delivery, initial = { x: unit.x, z: unit.z };
  updateCarrier(context, unit, .05);
  expect(unit.phase).toBe("pickup");
  expect(unit.path.length).toBeGreaterThan(20);
  for (const point of unit.path)
    expect(segments.some(segment => distanceToSegment(point, segment.start, segment.end) <= .65)).toBe(true);
  for (let tick = 0; tick < 40; tick++) {
    const previous = { x: unit.x, z: unit.z };
    beginPersonTrafficTick(context);
    updateCarrier(context, unit, .05);
    expect(Math.hypot(unit.x - previous.x, unit.z - previous.z)).toBeLessThan(.1);
  }
  expect(Math.hypot(unit.x - initial.x, unit.z - initial.z)).toBeGreaterThan(1);
  expect(unit.delivery).toBe(delivery);
  expect(unit.ware).toBeNull();
  expect(source.inventory.planks).toBe(4);
  expect(destination.incoming.planks).toBe(1);
});

it("does not search across open terrain when no short physical road join exists", () => {
  const { context, unit } = fixture();
  unit.x = 15; unit.z = 17;
  const initial = { x: unit.x, z: unit.z }, delivery = unit.delivery;
  resetTrafficWork();
  for (let tick = 0; tick < 5; tick++) updateCarrier(context, unit, .05);
  expect({ x: unit.x, z: unit.z }).toEqual(initial);
  expect(unit.delivery).toBe(delivery);
  expect(unit.action).toBe("idle");
  expect(snapshotTrafficWork().groundVisits).toBe(0);
});

it("replaces an already-running pre-fix cross-country pickup path with a road journey", () => {
  const { context, segments, source, unit } = fixture();
  unit.phase = "pickup";
  unit.path = [{ x: 17, z: 17 }, source.access];
  updateCarrier(context, unit, .05);
  expect(unit.phase).toBe("pickup");
  expect(unit.path.length).toBeGreaterThan(20);
  for (const point of unit.path)
    expect(segments.some(segment => distanceToSegment(point, segment.start, segment.end) <= .65)).toBe(true);
});

it("expires an unjoined claim; the empty carrier then walks home over dry ground without a road", () => {
  const { context, destination, source, unit } = fixture();
  context.clock = createGameClock(0);
  unit.x = 15; unit.z = 17;
  unit.delivery!.leaseStartedTick = 0;
  unit.delivery!.leaseDeadlineTick = 2;
  updateCarrier(context, unit, .05);
  expect(unit.delivery!.leaseDeadlineTick).toBe(2);
  context.clock.advance(2);
  updateCarrier(context, unit, .05);
  expect(unit.delivery).toBeUndefined();
  expect(destination.incoming.planks).toBe(0);
  expect(source.inventory.planks).toBe(5);
  // CARRIER-HOME (d46845527): with no road join, an EMPTY carrier walks home over real dry ground.
  expect(unit.ware).toBeNull();
  expect(unit.phase).toBe("home");
  expect(unit.visible).toBe(true);
  const previous = { x: unit.x, z: unit.z };
  for (let tick = 0; tick < 20; tick++) {
    beginPersonTrafficTick(context);
    updateCarrier(context, unit, .05);
  }
  expect(Math.hypot(unit.x - previous.x, unit.z - previous.z)).toBeGreaterThan(.5);
  expect(unit.delivery).toBeUndefined();
  expect(source.inventory.planks).toBe(5);
  expect(destination.incoming.planks).toBe(0);
});

it("physically exits only the current own court before following a distant source's road", () => {
  const scene = createTrafficWorld(40), { context } = scene;
  context.playerNation = "chinese"; context.nextBuilding = 0;
  context.options.canWorkerEnterPlot = (building, point) =>
    canWorkerEnterBuildingPlot(building, point, context.playerNation);
  const home = makeBuilding(context, 0, 10, 8, 0), source = makeBuilding(context, 39, 25, 8, 0);
  home.construction = source.construction = 1;
  context.buildings.push(home, source);
  expect(scene.roads.replaceSegments(roadsAlong([home.access, source.access]))).toBe(true);
  const unit = addActor(scene, { uid: 11, home: home.uid, building: source.uid, job: "Carrier",
    x: 9.25, z: 9.75, phase: "enterPickup", path: [source.workerApproach, source.doorThreshold] });
  unit.delivery = { source: source.uid, destination: home.uid, ware: "planks", reserved: false };
  const previous = { x: unit.x, z: unit.z };
  updateCarrier(context, unit, .05);
  expect(unit.phase).toBe("pickup");
  expect(unit.stockBuilding).toBe(home.uid);
  expect(Math.hypot(unit.x - previous.x, unit.z - previous.z)).toBeLessThan(.1);
  expect(unit.path.some(point => point.x === home.access.x && point.z === home.access.z)).toBe(true);
  expect(unit.path.at(-1)).toEqual(source.access);
});
