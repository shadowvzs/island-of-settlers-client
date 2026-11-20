import { expect, it } from "vitest";

import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";
import { getBuildingStockContact } from "../src/render-common/buildings/building-stock-anchors";
import { FISHING_WORK_TIMING } from "../src/shared/settlement/outdoor-work-timing";
import {
  FISHER_DOOR_LANE_CLEARANCE, FISHER_MIN_FEET_ABOVE_WATER, FISHING_MIN_WATER_DEPTH, fishingSites,
  isFishingShoreStep, isFishingStanceClear
} from "../src/shared/settlement/settlement-fishing";
import { isNavigationClear } from "../src/shared/settlement/settlement-navigation";
import { createActor, groundPath } from "../src/shared/settlement/settlement-paths";
import { claimBuilding, makeBuilding } from "../src/shared/settlement/settlement-placement";
import { consumeWorkTarget, findWorkTarget } from "../src/shared/settlement/settlement-resources";
import type {
  ResourceTarget, SettlementBuilding, SettlementContext
} from "../src/shared/settlement/settlement-types";
import { advanceFishingWorker, updateWorker } from "../src/shared/settlement/settlement-workers";
import { sampleSmooth } from "../src/shared/world/grid-geometry";
import { BLOCKING, BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = (provider?: ResourceTarget[], rotation = 0) => {
  const size = 32;
  const world = { cellsX: size, cellsZ: size, seaLevel: 0, seed: 1,
    heights: new Float32Array((size + 1) ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0 }, mineZones: [], oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2) } as unknown as WorldData;
  for (let z = 22; z < size; z++) for (let x = 0; x < size; x++) {
    world.blocking[z * size + x] = BLOCKING.water; world.walkCost[z * size + x] = 0;
  }
  const context = { options: { world,
    roads: { route: () => null, addRoad: () => true, upgradeRoad: () => true },
    resourceTargets: () => provider,
    canWorkerEnterPlot: (building, point) => isBuildingCourtyardPointWalkable(building.typeId,
      building.x, building.z, building.rotation, point),
    stockContact: (building, kind, ware, slot) => {
      const contact = getBuildingStockContact(building.typeId, kind, ware, slot,
        building.x, building.z, building.rotation)!;
      return { slot, ware, stock: { x: contact.warePosition[0], y: contact.warePosition[1], z: contact.warePosition[2] },
        approach: { x: contact.approach[0], y: contact.approach[1], z: contact.approach[2] } };
    } }, buildings: [], actors: [], occupied: new Uint8Array(size ** 2), reservations: new Set(),
    nextActor: 0, nextBuilding: 0, settlers: 1, resourceAmounts: new Map(), transfers: [],
    accumulator: 0, scheduling: 0 } as SettlementContext;
  const building = makeBuilding(context, 18, 16, 15, rotation);
  building.construction = 1; claimBuilding(context, building);
  const actor = createActor(context, "Fisher", building.uid);
  building.worker = actor.uid;
  return { context, building, actor, world };
};

const setShoreHeights = (world: WorldData, dry: number, wet: number) => {
  const stride = world.cellsX + 1;
  world.heights = Float32Array.from({ length: stride * (world.cellsZ + 1) },
    (_, index) => Math.floor(index / stride) <= 22 ? dry : wet);
};

const setGentleShore = (world: WorldData) => {
  const stride = world.cellsX + 1;
  const levels = [.3, .28, -.02, -.4];
  world.heights = Float32Array.from({ length: stride * (world.cellsZ + 1) }, (_, index) => {
    const z = Math.floor(index / stride);
    return levels[Math.max(0, Math.min(3, z - 21))]!;
  });
};

it("advances fishing phases through the event-plan helper", () => {
  const { actor, building, context } = fixture();
  actor.phase = "fishCast"; actor.action = "fish_cast"; actor.timer = FISHING_WORK_TIMING.cast;
  building.working = true;
  expect(advanceFishingWorker(context, actor)).toMatchObject({
    phase: "fishWait", action: "fish_wait", timer: FISHING_WORK_TIMING.wait, done: false
  });
  expect(advanceFishingWorker(context, actor)).toMatchObject({
    phase: "fishReel", action: "fish_reel", timer: FISHING_WORK_TIMING.reel, done: false
  });
});

it.each([undefined, [{ id: 99, kind: "fish", x: 16.5, z: 21.5 }],
  [{ id: 99, kind: "fish", x: 16.5, z: 22.5 }]] as Array<ResourceTarget[] | undefined>)(
  "casts into actual water from dry land and returns to outside stock using provider %j", provider => {
    const { actor, building, context, world } = fixture(provider);
    const phases = new Set<string>();
    let waitingYaw: number | undefined;
    for (let tick = 0; tick < 2400 && !building.output.fish; tick++) {
      actor.animationTime += .05; updateWorker(context, actor, .05); phases.add(actor.phase);
      if (["fishCast", "fishWait", "fishReel"].includes(actor.phase)) {
        expect(world.blocking[Math.floor(actor.z) * world.cellsX + Math.floor(actor.x)]).not.toBe(BLOCKING.water);
        expect(world.blocking[Math.floor(actor.target!.z) * world.cellsX + Math.floor(actor.target!.x)]).toBe(BLOCKING.water);
        expect(actor.yaw).toBeCloseTo(Math.atan2(actor.target!.x - actor.x, actor.target!.z - actor.z));
        waitingYaw = actor.yaw;
      }
    }
    expect(waitingYaw).toBeDefined();
    for (const phase of ["outbound", "fishCast", "fishWait", "fishReel", "outputWalk", "outputPutdown"])
      expect(phases.has(phase), JSON.stringify({ missing: phase, phases: [...phases], actor, contact: actor.stockContact })).toBe(true);
    expect(building.output.fish).toBe(1);
    expect(actor.ware).toBeNull();
    expect(["enterRest", "workerRestWait", "rest"]).toContain(actor.phase);
  }
);

it("rejects a custom inland fishing point and keeps provider records unchanged", () => {
  const provider: ResourceTarget[] = [{ id: 9, kind: "fish", x: 16.5, z: 16.5 }];
  const { building, context } = fixture(provider);
  expect(findWorkTarget(context, building, "fish")).toBeNull();
  expect(provider).toEqual([{ id: 9, kind: "fish", x: 16.5, z: 16.5 }]);
});


it.each([0, 1, 2, 3])("fills all six actual outside tray slots and rests at fishery rotation %i", rotation => {
  const { actor, building, context } = fixture(undefined, rotation);
  for (let tick = 0; tick < 9000 && (building.output.fish ?? 0) < 6; tick++) {
    actor.animationTime += .05; updateWorker(context, actor, .05);
  }
  expect(building.output.fish).toBe(6);
  expect(actor.ware).toBeNull();
  expect(context.reservations.size).toBe(0);
});


it("uses the selected inland lake surface height instead of the ocean level", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 22.5 }]);
  world.seaLevel = -.4;
  world.waterSurface = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1)).fill(2.75);
  setShoreHeights(world, 3, 0);
  expect(findWorkTarget(context, building, "fish")!.target.y).toBe(2.75);
  world.waterSurface.fill(NaN);
  setShoreHeights(world, 0, -1);
  expect(findWorkTarget(context, building, "fish")!.target.y).toBe(-.4);
});

it("casts beyond shallow rocky shoreline into clear deeper water", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  world.waterSurface = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  world.waterDepth = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1)).fill(.3);
  setShoreHeights(world, .3, -.3);
  world.props = { count: 1, types: new Uint8Array([PROP.largeRock]), scale: new Float32Array([.5]),
    x: new Float32Array([16.5]), z: new Float32Array([22.2]) } as WorldData["props"];
  const result = findWorkTarget(context, building, "fish")!;
  expect(result.target.z).toBeGreaterThan(23);
  expect(Math.hypot(result.target.x - 16.5, result.target.z - 22.2)).toBeGreaterThan(.85);
  expect(result.target.approach!.z).toBeLessThanOrEqual(21.15);
});

it("rejects classified water whose visible terrain is above the local surface", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  world.waterSurface = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  world.waterDepth = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1)).fill(.3);
  world.heights.fill(.1);
  expect(findWorkTarget(context, building, "fish")).toBeNull();
});

it("samples the water vertex layer at the actual offshore cast point", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  const stride = world.cellsX + 1;
  world.waterSurface = Float32Array.from({ length: stride * (world.cellsZ + 1) },
    (_, index) => 2 + (index % stride) * .01 + Math.floor(index / stride) * .02);
  setShoreHeights(world, 3, 0);
  const target = findWorkTarget(context, building, "fish")!.target;
  expect(target.y).toBeCloseTo(2 + target.x * .01 + target.z * .02, 6);
});

it("moves to the dry subcell edge with a complete .2-cell stance disk and continuous return route", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  const target = findWorkTarget(context, building, "fish")!.target;
  expect(target.approach!.z).toBeGreaterThan(21.5);
  expect(target.approach!.z).toBeLessThan(21.8);
  expect(target.x).toBe(16.5); expect(target.z).toBe(23.25);
  expect(groundPath(context, target.approach!, building.access)).not.toBeNull();
  for (let index = 0; index < 24; index++) {
    const angle = index * Math.PI / 12;
    const x = target.approach!.x + Math.cos(angle) * .2;
    const z = target.approach!.z + Math.sin(angle) * .2;
    expect(world.blocking[Math.floor(z) * world.cellsX + Math.floor(x)]).not.toBe(BLOCKING.water);
  }
});

it.each([0, 1, 2, 3])("reaches visibly dry beach beyond coarse water cells and carries six catches home at rotation %i", rotation => {
  const { actor, building, context, world } = fixture(undefined, rotation);
  world.waterSurface = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  world.waterDepth = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1)).fill(.3);
  setGentleShore(world);
  let shorelineSeen = false;
  for (let tick = 0; tick < 9000 && (building.output.fish ?? 0) < 6; tick++) {
    actor.animationTime += .05; updateWorker(context, actor, .05);
    if (["fishCast", "fishWait", "fishReel"].includes(actor.phase)) {
      shorelineSeen = true;
      expect(world.blocking[Math.floor(actor.z) * world.cellsX + Math.floor(actor.x)]).toBe(BLOCKING.water);
      expect(actor.z).toBeGreaterThan(22);
      expect(actor.target!.approach!.shoreEntry!.z).toBe(21.5);
    }
  }
  expect(shorelineSeen).toBe(true); expect(building.output.fish).toBe(6);
  expect(actor.ware).toBeNull(); expect(context.reservations.size).toBe(0);
});

it("does not grant the beach leg to carriers or unrelated Fisher routes", () => {
  const { building, context, world } = fixture();
  world.waterSurface = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  world.waterDepth = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1)).fill(.3);
  setGentleShore(world);
  const target = findWorkTarget(context, building, "fish")!.target;
  const point = target.approach!;
  expect(isNavigationClear(context, point)).toBe(false);
  expect(isFishingShoreStep(context, { job: "Fisher", target }, point)).toBe(true);
  expect(isFishingShoreStep(context, { job: "Carrier", target }, point)).toBe(false);
  expect(isFishingShoreStep(context, { job: "Fisher", target }, { x: point.x + 1, z: point.z })).toBe(false);
});

it("walks a caught fish around a blocked old shore entry instead of remaining returnBlocked", () => {
  const { actor, building, context, world } = fixture();
  world.waterSurface = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1));
  world.waterDepth = new Float32Array((world.cellsX + 1) * (world.cellsZ + 1)).fill(.3);
  setGentleShore(world);
  const target = findWorkTarget(context, building, "fish")!.target;
  Object.assign(actor, target.approach, {
    target, visible: true, ware: "fish", phase: "returnBlocked", action: "idle", timer: 0
  });
  // A blocker appears after fishing was selected, as can happen across a saved journey.
  world.blocking[21 * world.cellsX + 16] = BLOCKING.prop;
  world.walkCost[21 * world.cellsX + 16] = 0;
  world.buildRevision = 1;
  const path = groundPath(context, actor, building.access, building.uid);
  expect(path).not.toBeNull();
  for (let tick = 0; tick < 2400 && !building.output.fish; tick++) {
    actor.animationTime += .05;
    updateWorker(context, actor, .05);
    expect(actor.ware === "fish" || building.output.fish === 1).toBe(true);
  }
  expect(building.output.fish).toBe(1);
  expect(actor.ware).toBeNull();
});


it("stands on the closest steep-beach spot where the planted feet stay level",()=>{
  const {building,context,world}=fixture([{id:99,kind:"fish",x:16.5,z:21.5}]);
  world.waterSurface=new Float32Array((world.cellsX+1)*(world.cellsZ+1));
  world.waterDepth=new Float32Array((world.cellsX+1)*(world.cellsZ+1)).fill(.3);
  setShoreHeights(world,.3,-.3);
  const target=findWorkTarget(context,building,"fish")!.target,stand=target.approach!;
  // Down the beach past the flat grass edge (21.8), but never into the foam fringe.
  expect(stand.z).toBeGreaterThan(22);
  expect(stand.z).toBeLessThan(22.3);
  expect(isFishingStanceClear(context,stand,target as typeof target & { y: number })).toBe(true);
  expect(isFishingStanceClear(context,{x:stand.x,z:stand.z+.005},target as typeof target & { y: number })).toBe(false);
});
it("refuses a tall cliff bank even if its classified dry cell is walkable",()=>{
  const {context,world}=fixture();
  world.waterSurface=new Float32Array((world.cellsX+1)*(world.cellsZ+1));
  world.waterDepth=new Float32Array((world.cellsX+1)*(world.cellsZ+1)).fill(.3);
  setShoreHeights(world,3,-3);
  expect(fishingSites(context,{id:99,kind:"fish",x:16.5,z:21.5})).toEqual([]);
});

/** Vertex rows from the dry bank outwards; the water layers follow the rendered seabed. */
const setSeabedRows = (world: WorldData, rows: number[]) => {
  const stride = world.cellsX + 1, count = stride * (world.cellsZ + 1);
  const rowHeight = (index: number) => rows[Math.max(0, Math.min(rows.length - 1, Math.floor(index / stride) - 22))]!;
  world.heights = Float32Array.from({ length: count }, (_, index) => rowHeight(index));
  world.waterSurface = new Float32Array(count);
  world.waterDepth = Float32Array.from(world.heights, height => Math.max(0, -height));
};

it("never casts into the shore foam fringe of a shallow beach", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  setSeabedRows(world, [.3, -.15, -.15, -.15, -.15, -.6]);
  expect(findWorkTarget(context, building, "fish")).toBeNull();
});

it("casts farther past the foam band into water deep enough for fish", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  setSeabedRows(world, [.3, -.12, -.3]);
  const target = findWorkTarget(context, building, "fish")!.target;
  const stride = world.cellsX + 1, row = Math.floor(target.z), fraction = target.z - row;
  const seabed = world.heights[row * stride]! * (1 - fraction) + world.heights[(row + 1) * stride]! * fraction;
  expect(target.y! - seabed).toBeGreaterThanOrEqual(FISHING_MIN_WATER_DEPTH);
  // The shorter casts only reach the foam fringe here, so the longer cast is required.
  expect(target.z).toBeCloseTo(23.75);
  expect(world.blocking[Math.floor(target.z) * world.cellsX + Math.floor(target.x)]).toBe(BLOCKING.water);
});

it("does not cast from a stance held far back from the waterline by a shore rock", () => {
  const { context, world } = fixture();
  setSeabedRows(world, [.3, .2, -.6]);
  world.props = { count: 1, types: new Uint8Array([PROP.largeRock]), scale: new Float32Array([.5]),
    x: new Float32Array([16.5]), z: new Float32Array([22]) } as WorldData["props"];
  expect(fishingSites(context, { id: 99, kind: "fish", x: 16.5, z: 21.5 })).toEqual([]);
});

it("stands on sloped beach sand near the waterline instead of the grass edge", () => {
  const { context, world } = fixture();
  setSeabedRows(world, [.45, .1, -.3, -.8]);
  const [site] = fishingSites(context, { id: 99, kind: "fish", x: 16.5, z: 21.5 });
  const stand = site!.approach!;
  let waterline = stand.z;
  while (sampleSmooth(world, world.heights, stand.x, waterline) >= site!.y!) waterline += .01;
  expect(stand.z).toBeGreaterThan(22.3);
  expect(waterline - stand.z).toBeGreaterThan(.2);
  expect(waterline - stand.z).toBeLessThan(.8);
  expect(sampleSmooth(world, world.heights, stand.x, stand.z) - site!.y!).toBeGreaterThan(FISHER_MIN_FEET_ABOVE_WATER);
});

it("keeps the casting stance out of a door lane on the shore", () => {
  const { context, world } = fixture();
  setSeabedRows(world, [.45, .1, -.3, -.8]);
  const [site] = fishingSites(context, { id: 99, kind: "fish", x: 16.5, z: 21.5 });
  const stand = site!.approach!;
  const lane = { doorThreshold: { x: stand.x - 1, z: stand.z }, workerApproach: { x: stand.x, z: stand.z },
    access: { x: stand.x + 1, z: stand.z } } as SettlementBuilding;
  context.buildings.push(lane);
  const [moved] = fishingSites(context, { id: 99, kind: "fish", x: 16.5, z: 21.5 });
  expect(moved?.approach).not.toEqual(stand);
  if (moved) expect(Math.abs(moved.approach!.z - stand.z)).toBeGreaterThanOrEqual(FISHER_DOOR_LANE_CLEARANCE);
});


it("refuses a paid fishing target after its water is edited away before calling any consume hook", () => {
  const { building, context, world } = fixture([{ id: 99, kind: "fish", x: 16.5, z: 21.5 }]);
  const target = findWorkTarget(context, building, "fish")!.target;
  let consumes = 0;
  context.options.consumeResource = () => { consumes++; return true; };
  const cell = Math.floor(target.z) * world.cellsX + Math.floor(target.x);
  world.blocking[cell] = BLOCKING.free; world.walkCost[cell] = 10;
  world.buildRevision = (world.buildRevision ?? 0) + 1;
  expect(consumeWorkTarget(context, target, building)).toBe(false);
  expect(consumes).toBe(0);
  expect(building.output.fish ?? 0).toBe(0);
});
