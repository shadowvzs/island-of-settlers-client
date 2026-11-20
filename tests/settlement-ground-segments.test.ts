import { describe, expect, it } from "vitest";

import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import {
  findGroundPath,
  isGroundSegmentClear,
  isNavigationClear
} from "../src/shared/settlement/settlement-navigation";
import { groundPath, moveActor, setActorPath } from "../src/shared/settlement/settlement-paths";
import type {
  SettlementActor,
  SettlementContext,
  SettlementPoint
} from "../src/shared/settlement/settlement-types";
import { PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = (x: number, z: number, scale = 0.2) => {
  const size = 32;
  const world = {
    cellsX: size,
    cellsZ: size,
    heights: new Float32Array((size + 1) ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    props: {
      count: 1,
      types: new Uint8Array([PROP.broadleafTree]),
      scale: new Float32Array([scale]),
      x: new Float32Array([x]),
      z: new Float32Array([z])
    }
  } as unknown as WorldData;
  return {
    options: { world, roads: {} },
    occupied: new Uint8Array(size ** 2),
    actors: [],
    buildings: []
  } as unknown as SettlementContext;
};
const checkRoute = (context: SettlementContext, from: SettlementPoint, to: SettlementPoint) => {
  const path = findGroundPath(context, from, to);
  expect(path).not.toBeNull();
  let previous = from;
  for (const point of path!) {
    expect(isGroundSegmentClear(context, previous, point)).toBe(true);
    previous = point;
  }
  const actor = {
    uid: 0,
    ...from,
    y: 0,
    yaw: 0,
    visible: true,
    job: "Builder",
    action: "walk",
    phase: "builderWork",
    home: 0,
    building: 0,
    path: [],
    pathIndex: 0,
    timer: 0,
    animationTime: 0,
    ware: null
  } as SettlementActor;
  context.actors.push(actor);
  setActorPath(actor, path!, "builderWork");
  let arrived = false;
  for (let tick = 0; tick < 500; tick++) {
    arrived = moveActor(context, actor, 0.05);
    if (arrived) break;
  }
  expect(arrived).toBe(true);
  expect(actor.x).toBeCloseTo(to.x);
  expect(actor.z).toBeCloseTo(to.z);
  return path!;
};
describe("continuous ground route clearance", () => {
  it("detours when a small off-axis trunk lies between the old midpoint samples", () => {
    const context = fixture(10.125, 10.15);
    const from = { x: 10, z: 10 },
      to = { x: 10.5, z: 10 };
    for (const x of [10, 10.25, 10.5]) expect(isNavigationClear(context, { x, z: 10 })).toBe(true);
    expect(isGroundSegmentClear(context, from, to)).toBe(false);
    const path = checkRoute(context, from, to);
    expect(path.some((point) => point.z !== 10)).toBe(true);
  });
  it("rejects a near-tangent trunk crossing even between fine sample positions", () => {
    const context = fixture(10.025, 10.1719);
    const from = { x: 10, z: 10 },
      to = { x: 10.5, z: 10 };
    for (let i = 0; i <= 10; i++)
      expect(isNavigationClear(context, { x: 10 + i * 0.05, z: 10 })).toBe(true);
    expect(isGroundSegmentClear(context, from, to)).toBe(false);
    checkRoute(context, from, to);
  });
  it("routes from the actor's actual position when its rounded start node is blocked", () => {
    const context = fixture(10, 10);
    const from = { x: 10.23, z: 10.01 },
      to = { x: 11, z: 10 };
    expect(isNavigationClear(context, from)).toBe(true);
    expect(isNavigationClear(context, { x: 10, z: 10 })).toBe(false);
    checkRoute(context, from, to);
  });
  it("checks the actual final connector rather than skipping the last grid node", () => {
    const context = fixture(10.125, 10.15);
    const from = { x: 9, z: 10 },
      to = { x: 10.23, z: 10.01 };
    expect(isNavigationClear(context, to)).toBe(true);
    checkRoute(context, from, to);
  });
  it("detours a carrier around a trunk protruding into an existing road and preserves its cargo", () => {
    const context = fixture(10.125, 10.15);
    context.buildings.push({
      uid: 0,
      typeId: 17,
      construction: 1,
      x:14,z:7,y:0,width:4,depth:4,rotation:0,hasDoor:true,
      doorThreshold:{x:14,z:9},workerApproach:{x:14,z:9.5},
      access: { x: 14, z: 10 },
      incoming: { logs: 1 },
      input: {},
      inventory: {},
      output: {},
      accepts: {}
    } as any);
    const carrier = {
      uid: 0,
      x: 10,
      z: 10,
      y: 0,
      yaw: 0,
      visible: true,
      job: "Carrier",
      action: "carry",
      phase: "deliver",
      home: 0,
      building: 0,
      path: [
        { x: 10.5, z: 10 },
        { x: 11, z: 10 },
        { x: 12, z: 10 },
        { x: 14, z: 10 }
      ],
      pathIndex: 0,
      timer: 0,
      animationTime: 0,
      ware: "logs",
      delivery: { source: 2, destination: 0, ware: "logs" }
    } as SettlementActor;
    context.actors.push(carrier);
    let detoured = false;
    for (let tick = 0; tick < 600 && carrier.ware; tick++) {
      updateCarrier(context, carrier, 0.05);
      expect(isNavigationClear(context, carrier)).toBe(true);
      detoured ||= Math.abs(carrier.z - 10) > 0.1;
      if (carrier.ware === null) expect(carrier.x).toBeCloseTo(14);
    }
    expect(detoured).toBe(true);
    expect(carrier.ware).toBeNull();
    expect(context.buildings[0]!.input.logs).toBe(1);
    expect(context.buildings[0]!.incoming.logs).toBe(0);
  });
});

describe("owner stock courtyard navigation", () => {
  it("reaches an in-plot stock stand without crossing masonry or another reserved plot", () => {
    const context=fixture(28,28);
    const building={uid:1,typeId:1,x:10,z:10,width:4,depth:4,construction:1,rotation:0};
    context.buildings=[building as never];
    for(let z=8;z<12;z++)for(let x=8;x<12;x++)context.occupied[z*32+x]=1;
    context.options.canWorkerEnterPlot=(_building,point)=>point.z>=10.8;
    const from={x:10,z:12.5},to={x:10.8,z:11.3};
    expect(findGroundPath(context,from,to)).toBeNull();
    expect(groundPath(context,from,to)).toBeNull();
    expect(groundPath(context,from,to,99)).toBeNull();
    expect(groundPath(context,from,to,1)).not.toBeNull();
    const safe=(point:SettlementPoint)=>point.x>=8 && point.x<=12 && point.z>=8 && point.z<=12 &&
      !!context.options.canWorkerEnterPlot?.(building as never,point);
    const path=findGroundPath(context,from,to,undefined,safe)!;
    expect(path).not.toBeNull();
    expect(path.every(point=>point.z>=10.8)).toBe(true);
    expect(findGroundPath(context,from,{x:10,z:9},undefined,safe)).toBeNull();
    const actor={uid:0,job:"Carrier",phase:"pickupStockWalk",visible:true,x:from.x,z:from.z,y:0,
      ware:null,stockBuilding:1,path,pathIndex:0,timer:0} as SettlementActor;
    context.actors=[actor];
    for(let step=0;step<100 && actor.pathIndex<actor.path.length;step++)moveActor(context,actor,.05);
    expect(Math.hypot(actor.x-to.x,actor.z-to.z)).toBeLessThan(.03);
    // The canonical type 1 yard is public ground since 041bde88c (outdoor routing receipt 2026-11-05), but a
    // walker without this courtyard still never steps onto the owner's stock stand.
    actor.stockBuilding=undefined;actor.x=to.x;actor.z=12.05;actor.path=[{...to}];actor.pathIndex=0;
    for(let step=0;step<20;step++)moveActor(context,actor,.1);
    expect(isNavigationClear(context,actor)).toBe(true);
    expect(actor.z).toBeGreaterThan(to.z);
  });
});
