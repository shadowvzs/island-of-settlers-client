import { describe, expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { scheduleDeliveries, updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { createActor, moveActor, setActorPath } from "../src/shared/settlement/settlement-paths";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { startWareTransfer } from "../src/shared/settlement/settlement-stock-transfers";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";
import {
  outdoorWorkPath, stockErrandPath, stockToDoorPath
} from "../src/shared/settlement/settlement-worker-stock-paths";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import { BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = (typeId = 17, rotation = 0, connectRoad = true) => {
  const size = 48;
  const world = {
    cellsX: size,
    cellsZ: size,
    heights: new Float32Array((size + 1) ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    // Tree targets use id 0: the woodcutter's species filter reads it as an ordinary broadleaf tree.
    props: { count: 0, types: Uint8Array.of(PROP.broadleafTree) },
    mineZones: [],
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2)
  } as unknown as WorldData;
  const context = {
    options: {
      world,
      roads: null,
      consumeResource: () => true,
      stockContact: (building: any, kind: string, ware: string, slot: number) => ({
        ware,
        slot,
        yaw: Math.PI / 2,
        scale: 1,
        scale3: { x: 0.8, y: 1, z: 1 },
        stock: {
          x: building.x + (kind === "input" ? 1.2 : -1.2),
          y: 0.15,
          z: building.z + building.depth / 2 + 0.2
        },
        approach: {
          x: building.x + (kind === "input" ? 1.2 : -1.2),
          y: 0,
          z: building.z + building.depth / 2 + 0.7
        }
      })
    },
    buildings: [],
    actors: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set<string>(),
    nextActor: 1,
    nextBuilding: 0,
    settlers: 0,
    resourceAmounts: new Map(),
    accumulator: 0,
    scheduling: 0,
    transfers: []
  } as unknown as SettlementContext;
  const home = makeBuilding(context, 0, 5, 5, 0);
  home.construction = 1;
  home.inventory = {};
  const [baseWidth, baseDepth] = getBuildingDefinition(typeId).gridFootprint;
  const width = rotation % 2 ? baseDepth : baseWidth;
  const depth = rotation % 2 ? baseWidth : baseDepth;
  const building = makeBuilding(context, typeId,
    20 + (connectRoad ? 0 : width % 2 / 2),
    20 + (connectRoad ? 0 : depth % 2 / 2), rotation);
  building.construction = 1;
  context.buildings.push(home, building);
  for (const entry of context.buildings)
    for (let z = entry.z - entry.depth / 2; z < entry.z + entry.depth / 2; z++)
      for (let x = entry.x - entry.width / 2; x < entry.x + entry.width / 2; x++)
        context.occupied[Math.floor(z) * size + Math.floor(x)] = 1;
  context.options.roads = createRoadNetwork(world, {
    isBlocked: (x, z) => context.occupied[Math.floor(z) * size + Math.floor(x)] === 1
  });
  if (connectRoad) expect(context.options.roads.addRoad(home.access, building.access)).toBe(true);
  const actor = {
    uid: 0,
    x: 26,
    z: 26,
    y: 0,
    yaw: 0,
    visible: true,
    job: PRODUCTION_RULES[typeId]!.job,
    action: "work",
    ware: null,
    phase: "work",
    building: building.uid,
    home: home.uid,
    path: [],
    pathIndex: 0,
    timer: 0,
    animationTime: 0
  } as SettlementActor;
  return { context, home, building, actor };
};
const until = (
  context: SettlementContext,
  actor: SettlementActor,
  phase: string,
  carrier = false
) => {
  for (let i = 0; i < 2000 && actor.phase !== phase; i++)
    (carrier ? updateCarrier : updateWorker)(context, actor, 0.05);
  expect(actor.phase).toBe(phase);
};

it("rebuilds an invalidated carrier contact before lowering its cargo", () => {
  const { actor, building, context } = fixture(33);
  context.actors.push(actor);
  building.construction = .2;
  building.incoming.planks = 1;
  Object.assign(actor, { job: "Carrier", phase: "deliveryStockWalk", ware: "planks",
    stockBuilding: building.uid, stockContact: undefined, path: [], pathIndex: 0,
    delivery: { source: 0, destination: building.uid, ware: "planks" } });
  Object.assign(actor, building.access);
  expect(() => updateCarrier(context, actor, .05)).not.toThrow();
  expect(actor.stockContact?.ware).toBe("planks");
  expect(actor.ware).toBe("planks");
  expect(building.input.planks ?? 0).toBe(0);
  expect(building.incoming.planks).toBe(1);
  until(context, actor, "deliveryTransfer", true);
  expect(actor.wareTransfer).toMatchObject({ direction: "putdown", ware: "planks", progress: 0 });
  for (let i = 0; i < 20; i++) updateCarrier(context, actor, .05);
  expect(building.input.planks).toBe(1);
  expect(actor.ware).toBeNull();
});

it("rebuilds an invalidated worker input contact before consuming any stock", () => {
  const { actor, building, context } = fixture(33);
  context.actors.push(actor);
  building.input.logs = 2;
  Object.assign(actor, { phase: "inside", visible: false });
  Object.assign(actor, building.doorThreshold);
  updateWorker(context, actor, .05);
  expect(actor.phase).toBe("inputApproach");
  actor.stockContact = undefined;
  actor.path = [];
  actor.pathIndex = 0;
  expect(() => updateWorker(context, actor, .05)).not.toThrow();
  expect(actor.stockContact).toMatchObject({ ware: "logs" });
  expect(building.input.logs).toBe(2);
  expect(actor.ware).toBeNull();
  until(context, actor, "inputPickup");
  expect(building.input.logs).toBe(1);
  expect(actor.ware).toBe("logs");
});

it("changes an obstructed tree work stance without losing its reserved resource or producing early", () => {
  const { actor, building, context } = fixture();
  context.options.world.props = {
    count: 2,
    types: new Uint8Array([PROP.broadleafTree, PROP.broadleafTree]),
    scale: new Float32Array([1, 1]),
    x: new Float32Array([34.5, 35.5]),
    z: new Float32Array([32.5, 32.5])
  } as WorldData["props"];
  const target = { id: 0, kind: "tree" as const, x: 34.5, z: 32.5 };
  Object.assign(actor, { x: 35.435, z: 32.837, target, phase: "outbound", timer: 0,
    path: [{ x: 35.3, z: 32.5 }], pathIndex: 0, stockBuilding: building.uid });
  context.actors.push(actor);
  context.reservations.add("tree:0");
  let consumed = 0;
  context.options.consumeResource = resource => {
    expect(resource).toBe(target);
    consumed++;
    return true;
  };
  const before = { x: actor.x, z: actor.z };
  updateWorker(context, actor, .05);
  expect(Math.hypot(actor.x - before.x, actor.z - before.z)).toBeLessThanOrEqual(.045001);
  expect(actor.path.at(-1)).not.toEqual({ x: 35.3, z: 32.5 });
  expect(context.reservations.has("tree:0")).toBe(true);
  expect(consumed).toBe(0);
  until(context, actor, "work");
  expect(actor.target).toBe(target);
  for (let tick = 0; tick < 1000 && !consumed; tick++) updateWorker(context, actor, .05);
  expect(consumed).toBe(1);
  expect(actor.ware).toBe("logs");
  expect(context.reservations.has("tree:0")).toBe(false);
});

it("returns an empty carrier over real dry ground when its delivery site loses road connectivity", () => {
  const { actor, building, context, home } = fixture(33, 0, false);
  Object.assign(actor, { ...building.access, job: "Carrier", phase: "returnBlockedCarrier", timer: 0,
    stockBuilding: building.uid });
  context.actors.push(actor);
  const inventory = { ...home.inventory };
  context.options.findWorkerPath = () => null;
  updateCarrier(context, actor, .05);
  expect(actor.phase).toBe("returnBlockedCarrier");
  expect(actor.x).toBe(building.access.x);
  context.options.findWorkerPath = undefined;
  for (let tick = 0; tick < 2000 && actor.phase !== "inside"; tick++) {
    const before = { x: actor.x, z: actor.z };
    updateCarrier(context, actor, .05);
    expect(Math.hypot(actor.x - before.x, actor.z - before.z)).toBeLessThanOrEqual(.060001);
  }
  expect(actor.phase).toBe("inside");
  expect(actor.visible).toBe(false);
  expect(home.inventory).toEqual(inventory);
  expect(actor.ware).toBeNull();
  expect(context.actors).toHaveLength(1);
});
describe("physical exterior stock transfers", () => {
  it("woodcutter approaches the output pile and lowers its log before committing stock", () => {
    const { actor, building, context } = fixture();
    context.actors.push(actor);
    actor.target = { id: 0, kind: "tree", x: 26, z: 26 };
    updateWorker(context, actor, 0.05);
    expect(actor.phase).toBe("outputWalk");
    expect(actor.ware).toBe("logs");
    expect(actor.wareScale).toEqual({x:.8,y:1,z:1});
    expect(building.output.logs ?? 0).toBe(0);
    until(context, actor, "outputPutdown");
    expect(Math.hypot(actor.x - building.access.x, actor.z - building.access.z)).toBeGreaterThan(
      0.7
    );
    expect(actor.wareTransfer).toMatchObject({
      direction: "putdown",
      ware: "logs",
      progress: 0,
      scale3: { x: 0.8, y: 1, z: 1 }
    });
    for (let i = 0; i < 19; i++) updateWorker(context, actor, 0.05);
    expect(building.output.logs ?? 0).toBe(0);
    expect(actor.ware).toBe("logs");
    expect(actor.wareTransfer!.progress).toBeCloseTo(0.95);
    updateWorker(context, actor, 0.05);
    expect(building.output.logs).toBe(1);
    expect(actor.ware).toBeNull();
    expect(actor.wareTransfer).toBeUndefined();
    expect(actor.wareScale).toBeUndefined();
    expect(actor.phase).toBe("enterRest");
  });
  it("carpenter collects an outside input before processing and brings its output outdoors", () => {
    const { actor, building, context } = fixture(33);
    context.actors.push(actor);
    building.input.logs = 2;
    actor.phase = "inside";
    actor.visible = false;
    Object.assign(actor, building.doorThreshold);
    updateWorker(context, actor, 0.05);
    expect(actor.phase).toBe("inputApproach");
    expect(actor.path.some(point => Math.hypot(point.x-building.access.x, point.z-building.access.z) < .01)).toBe(false);
    expect(building.input.logs).toBe(2);
    expect(actor.ware).toBeNull();
    until(context, actor, "inputPickup");
    expect(building.input.logs).toBe(1);
    expect(actor.ware).toBe("logs");
    expect(actor.wareTransfer).toMatchObject({ direction: "pickup", progress: 0 });
    for (let i = 0; i < 19; i++) updateWorker(context, actor, 0.05);
    expect(actor.phase).toBe("inputPickup");
    updateWorker(context, actor, 0.05);
    expect(actor.phase).toBe("inputReturn");
    expect(actor.path.some(point => Math.hypot(point.x-building.access.x, point.z-building.access.z) < .01)).toBe(false);
    expect(actor.path.at(-1)).toEqual(building.doorThreshold);
    expect(actor.ware).toBe("logs");
    until(context, actor, "work");
    expect(actor.visible).toBe(false);
    expect(actor.ware).toBeNull();
    expect(actor.consumed).toEqual({ logs: 1 });
    until(context, actor, "outputPutdown");
    expect(actor.visible).toBe(true);
    expect(actor.ware).toBe("planks");
    expect(building.output.planks ?? 0).toBe(0);
    for (let i = 0; i < 20; i++) updateWorker(context, actor, 0.05);
    expect(building.output.planks).toBe(1);
    expect(building.input.logs).toBe(1);
  });
  it("reserves visible output until actual pickup and transfers it exactly once through storage's door", () => {
    const { building, context, home } = fixture(33);
    building.output.planks = 1;
    context.settlers = 1;
    home.idleSettlers = 1;
    scheduleDeliveries(context);
    const carrier = context.actors[0]!;
    expect(carrier.job).toBe("Carrier");
    expect(carrier.ware).toBeNull();
    expect(building.output.planks).toBe(1);
    expect(home.incoming.planks).toBe(1);
    scheduleDeliveries(context);
    expect(context.actors).toHaveLength(1);
    expect(building.output.planks).toBe(1);
    until(context, carrier, "pickupTransfer", true);
    expect(building.output.planks).toBe(0);
    expect(carrier.ware).toBe("planks");
    expect(carrier.wareTransfer).toMatchObject({ direction: "pickup", progress: 0 });
    for (let i = 0; i < 19; i++) updateCarrier(context, carrier, 0.05);
    expect(carrier.phase).toBe("pickupTransfer");
    expect(home.inventory.planks ?? 0).toBe(0);
    updateCarrier(context, carrier, 0.05);
    expect(carrier.phase).toBe("deliver");
    expect(carrier.ware).toBe("planks");
    until(context, carrier, "enterDelivery", true);
    expect(home.inventory.planks ?? 0).toBe(0);
    expect(carrier.ware).toBe("planks");
    until(context, carrier, "inside", true);
    expect(home.inventory.planks).toBe(1);
    expect(home.incoming.planks).toBe(0);
    expect(carrier.ware).toBeNull();
  });
  it("lowers construction inputs at their bay before inventory changes, retaining cargo through blocked approach", () => {
    const { actor, building, context } = fixture(33);
    context.actors.push(actor);
    building.construction = 0.2;
    building.incoming.planks = 1;
    actor.job = "Carrier";
    actor.phase = "deliver";
    actor.ware = "planks";
    actor.delivery = { source: 0, destination: building.uid, ware: "planks" };
    Object.assign(actor, building.access);
    context.options.findWorkerPath = () => null;
    updateCarrier(context, actor, 0.05);
    expect(actor.phase).toBe("carrierDeliveryBlocked");
    expect(actor.ware).toBe("planks");
    expect(building.input.planks ?? 0).toBe(0);
    for (let i = 0; i < 40; i++) updateCarrier(context, actor, 0.05);
    expect(actor.ware).toBe("planks");
    expect(building.incoming.planks).toBe(1);
    context.options.findWorkerPath = undefined;
    until(context, actor, "deliveryTransfer", true);
    expect(actor.wareTransfer).toMatchObject({ direction: "putdown", progress: 0 });
    expect(building.input.planks ?? 0).toBe(0);
    for (let i = 0; i < 19; i++) updateCarrier(context, actor, 0.05);
    expect(actor.ware).toBe("planks");
    expect(building.input.planks ?? 0).toBe(0);
    updateCarrier(context, actor, 0.05);
    expect(actor.ware).toBeNull();
    expect(building.input.planks).toBe(1);
    expect(building.incoming.planks).toBe(0);
  });
});

it("clears old cargo pose and input preparation when an idle settler takes another job",()=>{
  const {actor,context,home}=fixture();
  actor.phase="retired";actor.wareScale={x:2,y:2,z:2};actor.stockBuilding=55;
  actor.wareTransfer={direction:"pickup",ware:"logs",progress:.5,target:{x:4,y:0,z:4}};
  actor.productionInputs=["logs"];actor.preparedTarget={id:3,kind:"tree",x:4,z:4};
  context.actors.push(actor);context.settlers=1;home.idleSettlers=1;
  const recruited=createActor(context,"Carrier",home.uid);
  expect(recruited).toBe(actor);expect(recruited.wareScale).toBeUndefined();
  expect(recruited.stockBuilding).toBeUndefined();expect(recruited.wareTransfer).toBeUndefined();
  expect(recruited.productionInputs).toBeUndefined();expect(recruited.preparedTarget).toBeUndefined();
});

const distance = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.hypot(from.x - to.x, from.z - to.z);
/** The outer approach sits beside the road signpost; local stock errands must not reach it. */
const reachesSignpostSide = (points: { x: number; z: number }[], building: SettlementBuilding) =>
  points.some(point => distance(point, building.workerApproach) < .01 || distance(point, building.access) < .01);
const doorLaneOffset = (point: { x: number; z: number }, building: SettlementBuilding) => {
  const { doorThreshold: door, workerApproach: approach } = building;
  const length = distance(door, approach);
  const along = ((point.x - door.x) * (approach.x - door.x) + (point.z - door.z) * (approach.z - door.z)) / length;
  return { along, length, lateral: Math.abs(distance(point, door) ** 2 - along ** 2) ** .5 };
};

it("all production input errands turn from the doorstep to actual stocks at every rotation", () => {
  for (const [id, rule] of Object.entries(PRODUCTION_RULES)) {
    if (rule.service || !rule.inputs.length) continue;
    for (let rotation = 0; rotation < 4; rotation++) {
      const { actor, building, context } = fixture(Number(id), rotation, false);
      context.options.stockContact = createIslandStockContacts(context.options.world);
      for (const ware of rule.inputs) {
        const label = `${id}:${ware}:${rotation}`;
        building.input = Object.fromEntries(rule.inputs.map(input => [input, 2]));
        const contact = context.options.stockContact(building, "input", ware, 1);
        expect(contact, `${label} stock contact`).not.toBeNull();
        actor.visible = false;
        const outbound = stockErrandPath(context, actor, building, contact!.approach);
        expect(outbound, `${label} fetch path`).not.toBeNull();
        const turn = doorLaneOffset(outbound![0]!, building);
        expect(turn.lateral, `${label} leaves along the door lane`).toBeLessThan(.01);
        expect(turn.along, `${label} turns before the signpost`).toBeLessThan(turn.length - .1);
        expect(reachesSignpostSide(outbound!, building), `${label} outbound road detour`).toBe(false);
        actor.visible = true;
        actor.stockBuilding = building.uid;
        Object.assign(actor, contact!.approach);
        const inbound = stockToDoorPath(context, actor, building);
        expect(inbound, `${label} return path`).not.toBeNull();
        expect(inbound!.at(-1)).toEqual(building.doorThreshold);
        expect(reachesSignpostSide(inbound!, building), `${label} return road detour`).toBe(false);
      }
    }
  }
});

describe("workers walk directly between their door and exterior stock", () => {
  const SIGNPOST_SIDE_CLEARANCE = .1;
  const runCycle = (typeId: number, rotation: number) => {
    const { actor, building, context } = fixture(typeId, rotation, false);
    context.options.stockContact = createIslandStockContacts(context.options.world);
    context.actors.push(actor);
    const rule = PRODUCTION_RULES[typeId]!;
    building.input = Object.fromEntries(rule.inputs.map(ware => [ware, 2]));
    Object.assign(actor, building.doorThreshold, { phase: "inside", visible: false });
    const phases = new Set<string>();
    let closest = Infinity;
    for (let tick = 0; tick < 4000 && actor.phase !== "rest"; tick++) {
      updateWorker(context, actor, .05);
      phases.add(actor.phase);
      if (!actor.visible) continue;
      closest = Math.min(closest, distance(actor, building.workerApproach), distance(actor, building.access));
    }
    return { building, closest, phases, rule };
  };
  for (const typeId of [33, 6, 21, 23, 31])
    for (let rotation = 0; rotation < 4; rotation++)
      it(`type ${typeId} rotation ${rotation} fetches input and stacks output without the signpost`, () => {
        const { building, closest, phases, rule } = runCycle(typeId, rotation);
        for (const phase of ["inputApproach", "inputPickup", "inputReturn", "work", "outputWalk", "outputPutdown", "enterRest", "rest"])
          expect(phases.has(phase), phase).toBe(true);
        expect(building.input[rule.inputs[0]!]).toBe(1);
        expect(building.output[rule.outputs[0]!]).toBe(1);
        expect(closest).toBeGreaterThan(SIGNPOST_SIDE_CLEARANCE);
      });
});

describe("harvest deposits", () => {
  it("stores one ware per farm harvest and per workshop cycle", () => {
    for (const typeId of [37, 5, 33]) {
      const { actor, building, context } = fixture(typeId);
      context.actors.push(actor);
      const produced: string[] = [];
      context.options.onProduced = ware => produced.push(ware);
      Object.assign(actor, { phase: "outputPutdown", ware: "grain" });
      startWareTransfer(actor, "putdown", "grain", context.options.stockContact!(building, "output", "grain", 0)!);
      for (let tick = 0; tick < 20; tick++) updateWorker(context, actor, .05);
      expect(building.output.grain, `building ${typeId}`).toBe(1);
      expect(produced).toEqual(["grain"]);
    }
  });
});

describe("outdoor workers walk straight between their door and the work site", () => {
  /** The tree stands behind or beside the building, relative to its door (never past the road access). */
  const plantTree = (context: SettlementContext, building: SettlementBuilding, side: number) => {
    const out = { x: building.access.x - building.x, z: building.access.z - building.z };
    const length = Math.hypot(out.x, out.z);
    const forward = { x: out.x / length, z: out.z / length };
    const direction = [{ x: -forward.x, z: -forward.z }, { x: -forward.z, z: forward.x },
      { x: forward.z, z: -forward.x }][side]!;
    context.options.world.props = {
      count: 1, scale: new Float32Array([1]), types: new Uint8Array([PROP.broadleafTree]),
      x: new Float32Array([Math.floor(building.x + direction.x * 6) + .5]),
      z: new Float32Array([Math.floor(building.z + direction.z * 6) + .5])
    } as WorldData["props"];
  };
  for (let rotation = 0; rotation < 4; rotation++)
    for (const side of [0, 1, 2])
      it(`woodcutter rotation ${rotation} side ${side} never detours over the road access`, () => {
        const { actor, building, context } = fixture(17, rotation, false);
        plantTree(context, building, side);
        context.actors.push(actor);
        Object.assign(actor, building.doorThreshold, { phase: "inside", visible: false });
        const phases = new Set<string>();
        let closest = Infinity;
        for (let tick = 0; tick < 4000 && actor.phase !== "outputPutdown"; tick++) {
          updateWorker(context, actor, .05);
          phases.add(actor.phase);
          if (actor.visible) closest = Math.min(closest, distance(actor, building.access));
        }
        expect([...phases]).toEqual(expect.arrayContaining(["outbound", "work", "outputWalk", "outputPutdown"]));
        expect(closest).toBeGreaterThan(.1);
      });

  /** Work spots one tile outside every edge and corner of the plot, where yard shortcuts are tempting. */
  const spotsAroundPlot = (building: SettlementBuilding) => {
    const halfWidth = building.width / 2 + 1, halfDepth = building.depth / 2 + 1;
    return [-1, 0, 1].flatMap(sx => [-1, 0, 1].map(sz => ({ sx, sz }))).filter(({ sx, sz }) => sx || sz)
      .map(({ sx, sz }) => ({ x: building.x + sx * halfWidth, z: building.z + sz * halfDepth }));
  };
  // Palm grove 5 also hosts hives, rice and vines; 27 charcoal and 37 farm fields; 17/18/19/20 trees,
  // shores, rocks and plantings. Regression: the palm grower froze in its own yard (2026-10-15).
  it.each([5, 17, 18, 19, 20, 27, 37].flatMap(typeId => [0, 1, 2, 3].map(rotation => [typeId, rotation])))(
    "building %i rotation %i: an outdoor worker can walk every planned work leg to its end", (typeId, rotation) => {
      const { actor, building, context } = fixture(typeId, rotation, false);
      context.actors.push(actor);
      for (const spot of spotsAroundPlot(building)) {
        const path = outdoorWorkPath(context, building, spot);
        expect(path).not.toBeNull();
        Object.assign(actor, building.workerApproach, { action: "walk", stockBuilding: undefined });
        setActorPath(actor, [building.workerApproach, ...path!], "outbound");
        let arrived = false;
        for (let tick = 0; tick < 1200 && !arrived; tick++) arrived = moveActor(context, actor, .05);
        expect(arrived, `stuck at ${actor.x.toFixed(2)},${actor.z.toFixed(2)} towards ${spot.x},${spot.z}`)
          .toBe(true);
      }
    });
});
