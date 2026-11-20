import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { SettlementActor, SettlementContext, SettlementStockContact } from "../src/shared/settlement/settlement-types";

vi.mock("../src/shared/settlement/settlement-worker-stock-paths", () => ({
  stockErrandPath: (_context: unknown, actor: SettlementActor, _building: unknown, goal: { x: number; z: number }) =>
    [{ x: actor.x + .1, z: actor.z }, goal]
}));

// The unit project shares one module graph per worker (isolate: false): load a fresh copy that sees the mock,
// and drop the mock afterwards so later files get the real stock paths.
let reconcileLoadedStockLayouts: typeof import(
  "../src/shared/settlement/settlement-stock-layout-restore"
).reconcileLoadedStockLayouts;
beforeAll(async () => {
  vi.resetModules();
  ({ reconcileLoadedStockLayouts } = await import("../src/shared/settlement/settlement-stock-layout-restore"));
});
afterAll(() => {
  vi.doUnmock("../src/shared/settlement/settlement-worker-stock-paths");
  vi.resetModules();
});

it("rebinds an old handling target once without restarting its timer, moving the actor or changing cargo", () => {
  const before: SettlementStockContact = { ware: "wine", slot: 2, stock: { x: 3, y: .2, z: 4 },
    approach: { x: 3, y: 0, z: 4.4 } };
  const after = { ...before, stock: { ...before.stock, x: 2.7 }, approach: { ...before.approach, x: 2.7 } };
  const actor = { uid: 8, x: 3, z: 4.4, phase: "pickupTransfer", ware: null, timer: .4, stockBuilding: 2,
    delivery: { source: 2, destination: 3 }, stockContact: before,
    wareTransfer: { progress: .4, target: before.stock, direction: "pickup", ware: "wine" } } as SettlementActor;
  const building = { uid: 2, typeId: 6, construction: 1, output: { wine: 6 }, incoming: {} };
  let queries = 0;
  const context = { actors: [actor], buildings: [building], options: { stockContact: () => {
    queries++; return after;
  } } } as unknown as SettlementContext;
  reconcileLoadedStockLayouts(context);
  expect(actor.stockContact).toBe(after);
  expect(actor.wareTransfer?.target).toEqual(after.stock);
  expect(actor.wareTransfer?.progress).toBe(.4);
  expect([actor.uid, actor.x, actor.z, actor.timer, actor.ware]).toEqual([8, 3, 4.4, .4, null]);
  expect(building.output).toEqual({ wine: 6 });
  const transfer = actor.wareTransfer;
  reconcileLoadedStockLayouts(context);
  expect(actor.wareTransfer).toBe(transfer);
  expect(queries).toBe(2);
});

it("replans an old approaching walk from its current position without restarting custody or the timer", () => {
  const before: SettlementStockContact = { ware: "grain", slot: 1, stock: { x: 3, y: .1, z: 5 },
    approach: { x: 3, y: 0, z: 5.4 } };
  const after = { ...before, stock: { ...before.stock, z: 4.5 }, approach: { ...before.approach, z: 4.9 } };
  const actor: SettlementActor = { uid: 8, x: 3, y: 0, z: 2, yaw: 0, visible: true,
    job: "Carrier", action: "walk", building: 2, home: 3, animationTime: 0,
    phase: "inputApproach", ware: null, timer: .6, stockBuilding: 2,
    path: [before.approach], pathIndex: 0, stockContact: before };
  const context = { actors: [actor], buildings: [{ uid: 2, typeId: 28, construction: 1 }],
    options: { stockContact: () => after } } as unknown as SettlementContext;
  reconcileLoadedStockLayouts(context);
  expect(actor.path.at(-1)).toEqual(after.approach);
  expect(actor.path[0]).toEqual({ x: 3.1, z: 2 });
  expect([actor.uid, actor.x, actor.z, actor.phase, actor.timer, actor.stockBuilding]).toEqual(
    [8, 3, 2, "inputApproach", .6, 2]);
});

it("rebinds only a proven hanging-display cargo scale without restarting or losing the hide", () => {
  const before: SettlementStockContact = { ware: "hides", slot: 0, stock: {x:1,y:1.05,z:2},
    approach:{x:1,y:0,z:2.3}, scale3:{x:2.766,y:14.89,z:.331} };
  const after: SettlementStockContact = {...before,presentation:"hanging",stock:{x:1,y:1.06,z:2},
    scale3:{x:1.45,y:1.45,z:1.45}};
  const actor = {uid:8,x:1,y:0,z:2.3,yaw:0,visible:true,job:"Tanner",action:"carry",building:2,home:2,
    animationTime:0,path:[],pathIndex:0,phase:"inputPickup",ware:"hides",timer:.4,stockBuilding:2,
    stockContact:before,wareScale:{...before.scale3!},consumed:{hides:1},
    wareTransfer:{progress:.4,target:before.stock,direction:"pickup",ware:"hides"}} as SettlementActor;
  const context = {actors:[actor],buildings:[{uid:2,typeId:8,construction:1}],
    options:{stockContact:()=>after}} as unknown as SettlementContext;
  reconcileLoadedStockLayouts(context);
  expect(actor.wareScale).toEqual(after.scale3);
  expect(actor.wareTransfer).toMatchObject({progress:.4,presentation:"hanging",target:after.stock});
  expect([actor.x,actor.z,actor.timer,actor.ware,actor.consumed]).toEqual([1,2.3,.4,"hides",{hides:1}]);
  actor.stockContact=before; actor.wareScale={x:.9,y:.9,z:.9};
  reconcileLoadedStockLayouts(context);
  expect(actor.wareScale).toEqual({x:.9,y:.9,z:.9});
});

it("reroutes an old front-door boat putdown to the fishery yard without consuming its cargo", () => {
  const before: SettlementStockContact = { ware: "boat", slot: 0, stock: { x: 3, y: .15, z: 4 },
    approach: { x: 3, y: 0, z: 4.4 } };
  const after = { ...before, stock: { x: 3, y: 0, z: 1 }, approach: { x: 3, y: 0, z: .2 }, yaw: Math.PI };
  const actor = { uid: 8, x: 3, y: 0, z: 4.4, yaw: 0, visible: true, job: "Carrier", action: "carry",
    phase: "deliveryTransfer", ware: "boat", timer: .4, stockBuilding: 2, building: 1, home: 1, animationTime: 0, path: [], pathIndex: 0,
    delivery: { source: 1, destination: 2, ware: "boat" }, stockContact: before,
    wareTransfer: { progress: .4, target: before.stock, direction: "putdown", ware: "boat" } } as SettlementActor;
  const building = { uid: 2, typeId: 18, construction: 1, input: {}, incoming: { boat: 1 } };
  const context = { actors: [actor], buildings: [building], options: { stockContact: () => after } } as unknown as SettlementContext;
  reconcileLoadedStockLayouts(context);
  expect(actor.phase).toBe("deliveryStockWalk");
  expect(actor.path.at(-1)).toEqual(after.approach);
  expect(actor.wareTransfer).toBeUndefined();
  expect(actor.stockContact).toBe(after);
  expect(actor.ware).toBe("boat");
  expect(building.input).toEqual({});
  expect(building.incoming).toEqual({ boat: 1 });
});
