import { describe, expect, it } from "vitest";

import { getConstructionCost } from "../src/shared/settlement/construction-costs";
import { scheduleDeliveries } from "../src/shared/settlement/settlement-logistics";
import { createNavalPassengers } from "../src/shared/settlement/settlement-naval-passengers";
import {
  createExpeditionPreparations, EXPEDITION_CREW, EXPEDITION_EQUIPMENT, EXPEDITION_ROLES,
  EXPEDITION_SUPPLIES
} from "../src/shared/settlement/settlement-naval-preparation";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (reachable = true) => {
  const size = 40;
  const world = { seed: 1, cellsX: size, cellsZ: size, seaLevel: -1,
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  const context: SettlementContext = { options: { world,
    roads: { route: (from, to) => reachable || Math.hypot(from.x - to.x, from.z - to.z) < 1
      ? { points: [{ ...to }], cost: 10, length: 10 } : null,
      addRoad: () => true, upgradeRoad: () => true },
    findWorkerPath: (_from, to) => [{ ...to }] },
    buildings: [], actors: [], occupied: new Uint8Array(size ** 2), reservations: new Set(),
    nextActor: 0, nextBuilding: 0, settlers: 23, resourceAmounts: new Map(),
    accumulator: 0, scheduling: 0, transfers: [] };
  const home = makeBuilding(context, 0, 6, 6, 0), harbour = makeBuilding(context, 39, 20, 6, 0);
  const secondHarbour = makeBuilding(context, 39, 20, 20, 0);
  for (const building of [home, harbour, secondHarbour]) building.construction = 1;
  home.idleSettlers = 20; harbour.idleSettlers = 3; secondHarbour.idleSettlers = 0;
  context.buildings.push(home, harbour, secondHarbour);
  const passengers = createNavalPassengers(context);
  let ship: { id: number; phase: string; reservedFor?: number; sourceUid?: number } | null = null;
  let accepted = true, shore = true, handovers = 0;
  const orders: Array<{ id: number; sourceUid: number; destinationUid: number; cargo: Record<string, number>;
    shipId?: number }> = [];
  const fleet = {
    snapshot: () => ship ? [ship as never] : [], pending: () => orders,
    reserveShip: (_sourceUid: number, operationId: number) => {
      if (!ship || ship.reservedFor !== undefined) return null;
      ship.reservedFor = operationId;
      return ship.id;
    },
    releaseShipReservation: (operationId: number) => {
      if (ship?.reservedFor !== operationId) return false;
      ship.reservedFor = undefined;
      return true;
    },
    reservedShip: (shipId: number) => ship?.id === shipId && ship.reservedFor !== undefined ? shipId : null,
    expeditionTargets: () => [],
    queueTransport: (_source: number, _destination: number, cargo: Record<string, number>,
      _passengers: number[] = [], _target?: unknown, _exploration?: unknown, _colony?: unknown,
      shipId?: number) => {
      if (!accepted) return null;
      handovers++;
      for (const [ware, count] of Object.entries(cargo)) harbour.inventory[ware]! -= count;
      orders.push({ id: handovers, sourceUid: _source, destinationUid: _destination, cargo: { ...cargo }, shipId });
      return handovers;
    }
  };
  const preparations = createExpeditionPreparations(context, { passengers,
    site: point => shore ? { ...point, water: { x: 30, z: 10 } } : null, fleet });
  context.naval = { expeditionDemand: preparations.demand };
  return { context, home, harbour, secondHarbour, preparations, fleet, orders,
    setShip: () => { ship = { id: 1, phase: "idle" }; return ship; },
    getShip: () => ship, blockShore: () => { shore = false; }, accept: (value: boolean) => { accepted = value; },
    handovers: () => handovers };
};
const target = { x: 30, z: 12, rotation: 0 };
const exact = { ...getConstructionCost(39, "roman"), ...EXPEDITION_EQUIPMENT };

describe("persistent harbour expedition preparation", () => {
  it("derives the receipt and three roles from the canonical harbour recipe", () => {
    expect(EXPEDITION_SUPPLIES).toEqual({ ...getConstructionCost(39, "roman"), ...EXPEDITION_EQUIPMENT });
    expect(EXPEDITION_EQUIPMENT).toEqual({ hammer: 1, shovel: 1 });
    expect(EXPEDITION_ROLES).toEqual(["Builder", "Leveler", "Carrier"]);
    expect(EXPEDITION_CREW).toBe(3);
  });
  it("refuses without a reachable idle ship or reachable stock, without deducting anything", () => {
    const { harbour, preparations } = fixture();
    harbour.inventory = { ...exact };
    expect(preparations.start(harbour.uid, target)).toBeNull();
    expect(harbour.inventory).toEqual(exact);
    const noStock = fixture();
    noStock.setShip();
    noStock.home.inventory = { planks: 4, stone: 3, hammer: 1, shovel: 1 };
    expect(noStock.preparations.start(noStock.harbour.uid, target)).toBeNull();
    expect(noStock.harbour.inventory).toEqual({});
    expect(noStock.getShip()?.reservedFor).toBeUndefined();
    const unreachable = fixture(false);
    unreachable.setShip();
    unreachable.home.inventory = { ...exact };
    expect(unreachable.preparations.start(unreachable.harbour.uid, target)).toBeNull();
    expect(unreachable.getShip()?.reservedFor).toBeUndefined();
  });
  it("rejects an invalid or already occupied destination without reserving anything", () => {
    const { blockShore, getShip, harbour, preparations, setShip } = fixture();
    setShip();
    harbour.inventory = { ...exact };
    blockShore();
    expect(preparations.start(harbour.uid, target)).toBeNull();
    expect(harbour.inventory).toEqual(exact);
    expect(getShip()?.reservedFor).toBeUndefined();
  });
  it("reserves a real crew, equipment and the selected ship, then refunds exactly once", () => {
    const { context, getShip, harbour, home, preparations, setShip } = fixture();
    setShip();
    home.inventory = { planks: 3, stone: 5, hammer: 1, shovel: 1 };
    harbour.inventory = { planks: 2, stone: 1 };
    preparations.start(harbour.uid, target);
    const ship = getShip()!;
    expect(ship.reservedFor).toBe(-1);
    expect(preparations.snapshot()[0]).toMatchObject({ cargo: { planks: 2, stone: 1 },
      crew: 3, shipAvailable: true, status: "supplies" });
    expect(context.actors.map(actor => actor.job)).toEqual(["Builder", "Leveler", "Carrier"]);
    expect(harbour.idleSettlers).toBe(0);
    expect(harbour.inventory).toEqual({ planks: 0, stone: 0 });
    harbour.incoming = { planks: 1, stone: 3 };
    expect(preparations.demand(harbour.uid)).toEqual({ planks: 2, stone: 2, hammer: 1, shovel: 1 });
    expect(preparations.cancel(-1)).toBe(true);
    expect(preparations.cancel(-1)).toBe(false);
    expect(harbour.inventory).toEqual({ planks: 2, stone: 1 });
    expect(harbour.idleSettlers).toBe(3);
    expect(ship.reservedFor).toBeUndefined();
    expect(context.actors.every(actor => actor.phase === "retired")).toBe(true);
  });
  it("requests missing goods through ordinary carriers and counts incoming goods only once", () => {
    const { context, harbour, home, preparations, setShip } = fixture();
    setShip();
    home.inventory = { ...exact };
    preparations.start(harbour.uid, target);
    for (let i = 0; i < 13; i++) {
      scheduleDeliveries(context);
      // Each dispatched carrier walks out of the door before the next step (the door lets few wait indoors).
      for (const actor of context.actors) if (actor.delivery) actor.visible = true;
    }
    expect(harbour.incoming).toEqual(exact);
    expect(home.inventory).toEqual({ planks: 0, stone: 0, hammer: 0, shovel: 0 });
    expect(context.actors.filter(actor => actor.delivery)).toHaveLength(13);
    expect(preparations.demand(harbour.uid)).toEqual({ planks: 0, stone: 0, hammer: 0, shovel: 0 });
    preparations.cancel(-1);
    expect(harbour.incoming).toEqual(exact);
  });
  it("retains the paid receipt and its ship across reload, then hands over once", () => {
    const { harbour, home, preparations, setShip } = fixture();
    setShip();
    home.inventory = { planks: 3, stone: 5, hammer: 1, shovel: 1 };
    harbour.inventory = { planks: 2, stone: 1 };
    expect(preparations.start(harbour.uid, target)).toBe(-1);
    const saved = preparations.saveState(); preparations.restore(saved);
    saved.preparations[0]!.cargo.planks = 100;
    expect(preparations.saveState().preparations[0]?.cargo.planks).toBe(2);
    harbour.inventory.planks = (harbour.inventory.planks ?? 0) + 3;
    harbour.inventory.stone = (harbour.inventory.stone ?? 0) + 5;
    harbour.inventory.hammer = 1; harbour.inventory.shovel = 1;
    preparations.update(1);
    expect(preparations.snapshot()).toEqual([]);
    expect(harbour.inventory).toEqual({ planks: 0, stone: 0, hammer: 0, shovel: 0 });
    expect(preparations.saveState().preparations).toEqual([]);
  });
  it("returns paid partial preparation when its source harbour is removed", () => {
    const { harbour, home, preparations, setShip } = fixture();
    setShip();
    home.inventory = { planks: 3, stone: 5, hammer: 1, shovel: 1 };
    harbour.inventory = { planks: 2, stone: 1 };
    expect(preparations.start(harbour.uid, target)).toBe(-1);
    preparations.removeBuilding(harbour.uid);
    expect(preparations.snapshot()).toEqual([]);
    expect(harbour.inventory).toEqual({ planks: 2, stone: 1 });
    expect(harbour.idleSettlers).toBe(3);
  });
  it("keeps one operation per harbour and one target claim across harbours", () => {
    const { harbour, home, preparations, secondHarbour, setShip } = fixture();
    setShip();
    home.inventory = { planks: 8, stone: 12, hammer: 2, shovel: 2 };
    harbour.inventory = { planks: 2 };
    secondHarbour.inventory = { ...exact };
    secondHarbour.idleSettlers = 3;
    expect(preparations.start(harbour.uid, target)).toBe(-1);
    expect(preparations.start(harbour.uid, { ...target, x: 26 })).toBeNull();
    expect(preparations.start(secondHarbour.uid, target)).toBeNull();
    expect(secondHarbour.inventory).toEqual(exact);
  });
  it("keeps the harbour expedition slot while an exploration ship is still returning", () => {
    const { getShip, harbour, preparations, setShip } = fixture();
    const ship = setShip();
    harbour.inventory = { ...exact };
    ship.sourceUid = harbour.uid;
    (ship as unknown as { exploration: object }).exploration =
      { cursor: 1, points: [{ x: 30, z: 12 }], returning: true };
    expect(preparations.start(harbour.uid, target)).toBeNull();
    expect(harbour.inventory).toEqual(exact);
    expect(getShip()?.reservedFor).toBeUndefined();
  });
  it("holds isolated stock when the handover is refused, then refunds it safely", () => {
    const { accept, harbour, home, preparations, setShip } = fixture();
    setShip();
    home.inventory = { planks: 3, stone: 5, hammer: 1, shovel: 1 };
    harbour.inventory = { planks: 2, stone: 1 };
    const id = preparations.start(harbour.uid, target)!;
    expect(id).toBe(-1);
    harbour.inventory = { planks: 3, stone: 5, hammer: 1, shovel: 1 };
    accept(false);
    preparations.update(1);
    expect(preparations.snapshot()[0]).toMatchObject({ status: "shore" });
    expect(preparations.cancel(id)).toBe(true);
    expect(harbour.inventory).toEqual(exact);
  });
});
