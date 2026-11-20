import { describe, expect, it } from "vitest";

import { PRODUCTION_RULES } from "../src/shared/settlement/production-rules";
import {
  constructionHits,
  constructionWorkPositions
} from "../src/shared/settlement/settlement-construction";
import { updateCarrier } from "../src/shared/settlement/settlement-logistics";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import { storageDoorLanePoint } from "../src/shared/settlement/settlement-storage-door-lanes";
import { actorSeparation } from "../src/shared/settlement/settlement-traffic";
import type {
  SettlementActor,
  SettlementContext,
  SettlementPoint
} from "../src/shared/settlement/settlement-types";
import { updateWorker } from "../src/shared/settlement/settlement-workers";
import { BLOCKING, BUILD, PROP, type WorldData } from "../src/shared/world/world-data";

const fixture = (typeId = 17) => {
  const size = 48;
  const world = {
    cellsX: size,
    cellsZ: size,
    heights: new Float32Array((size + 1) ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2),
    slopeClass: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    // Tree targets use id 0: the woodcutter's species filter reads it as an ordinary broadleaf tree.
    props: { count: 0, types: Uint8Array.of(PROP.broadleafTree) },
    mineZones: [],
    oreAmount: new Uint8Array(size ** 2),
    mineZone: new Uint16Array(size ** 2)
  } as unknown as WorldData;
  let blocked = false,
    consumed = 0;
  const route = (from: SettlementPoint, to: SettlementPoint) =>
    blocked ? null : { points: [to], cost: Math.hypot(from.x - to.x, from.z - to.z), length: 1 };
  const context = {
    options: {
      world,
      roads: { route, addRoad: () => true, upgradeRoad: () => true },
      findWorkerPath: (_from: SettlementPoint, to: SettlementPoint) => (blocked ? null : [to]),
      consumeResource: () => {
        consumed++;
        return true;
      }
    },
    buildings: [],
    actors: [],
    occupied: new Uint8Array(size ** 2),
    reservations: new Set<string>(),
    nextActor: 0,
    nextBuilding: 0,
    settlers: 0,
    resourceAmounts: new Map(),
    accumulator: 0,
    scheduling: 0,
    transfers: []
  } as SettlementContext;
  const home = makeBuilding(context, 0, 5, 5, 0);
  home.construction = 1;
  home.inventory = { hammer: 0 };
  const building = makeBuilding(context, typeId, 20, 20, 0);
  building.construction = 1;
  context.buildings.push(home, building);
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
  context.actors.push(actor);
  return {
    context,
    home,
    building,
    actor,
    setBlocked: (value: boolean) => {
      blocked = value;
    },
    consumed: () => consumed
  };
};

describe("civilian blocked return ownership", () => {
  it.each([
    [17, "tree", "logs"],
    [18, "fish", "fish"],
    [19, "stone", "stone"],
    [22, "wildlife", "meat"],
    [37, "field", "grain"],
    [20, "plant", null]
  ] as const)(
    "worker %s waits at its work site and carries home without a remote deposit",
    (id, kind, ware) => {
      const { actor, building, consumed, context, setBlocked } = fixture(id);
      actor.target = { id: 0, kind, x: 26, z: 26 };
      // A paid catch is only valid while its cast point is real water.
      if (kind === "fish") context.options.world.blocking[26 * 48 + 26] = BLOCKING.water;
      setBlocked(true);
      updateWorker(context, actor, 0.05);
      expect(actor.phase).toBe("returnBlocked");
      expect(actor.ware).toBe(ware);
      expect(building.output).toEqual({});
      expect(consumed()).toBe(1);
      for (let i = 0; i < 80; i++) updateWorker(context, actor, 0.05);
      expect(actor.x).toBe(26);
      expect(actor.z).toBe(26);
      expect(actor.visible).toBe(true);
      expect(actor.ware).toBe(ware);
      expect(consumed()).toBe(1);
      setBlocked(false);
      for (let i = 0; i < 1000 && actor.phase !== "enterRest"; i++)
        updateWorker(context, actor, 0.05);
      expect(actor.phase).toBe("enterRest");
      expect(actor.ware).toBeNull();
      expect(Math.hypot(actor.x - building.access.x, actor.z - building.access.z)).toBeLessThan(
        0.001
      );
      expect(ware ? building.output[ware] : Object.keys(building.output).length).toBe(ware ? 1 : 0);
      expect(consumed()).toBe(1);
    }
  );
  it("deposits completed overflow, then starts no further work while output remains full", () => {
    const { actor, building, context } = fixture();
    building.output = { logs: 6 };
    actor.phase = "returnWork";
    actor.ware = "logs";
    Object.assign(actor, building.access);
    for (let i = 0; i < 200; i++) updateWorker(context, actor, .05);
    expect(building.output.logs).toBe(7);
    expect(actor.ware).toBeNull();
    expect(building.status).toBe("Output stock full");
    expect(actor.phase).toBe("inside");
  });
  it("keeps a completed builder outside with its hammer until a real return route exists", () => {
    const { actor, building, context, home, setBlocked } = fixture();
    building.construction = 1 - 1 / constructionHits(building);
    building.required = {};
    actor.job = "Builder";
    actor.tool = "hammer";
    actor.phase = "inside";
    Object.assign(actor, constructionWorkPositions(building)[3]);
    updateWorker(context, actor, 0.05);
    updateWorker(context, actor, 0.05);
    expect(actor.phase).toBe("construct");
    actor.animationTime = 0.75;
    setBlocked(true);
    updateWorker(context, actor, 0.05);
    expect(building.construction).toBe(1);
    expect(actor.phase).toBe("builderReturnBlocked");
    expect(actor.visible).toBe(true);
    expect(actor.tool).toBe("hammer");
    expect(context.settlers).toBe(0);
    for (let i = 0; i < 100; i++) updateWorker(context, actor, 0.05);
    expect(building.output).toEqual({});
    expect(actor.phase).toBe("builderReturnBlocked");
    setBlocked(false);
    for (let i = 0; i < 2000 && actor.phase !== "retired"; i++) updateWorker(context, actor, 0.05);
    expect(actor.phase).toBe("retired");
    expect(home.inventory.hammer).toBe(1);
    expect(context.settlers).toBe(1);
    expect(actor.tool).toBeUndefined();
  });
  it("carries cargo through the storage door before depositing and resting inside", () => {
    const { actor, context, home } = fixture();
    // HQ has the owner's explicit foot-traffic overlap exemption; ordinary storage remains single-file.
    home.typeId = 29;
    actor.job = "Carrier";
    actor.phase = "deliver";
    actor.building = home.uid;
    actor.delivery = { source: 1, destination: home.uid, ware: "logs" };
    actor.ware = "logs";
    Object.assign(actor, home.access);
    home.incoming = { logs: 1 };
    const busy = {
      ...actor,
      uid: 1,
      phase: "enterHome",
      ware: null,
      delivery: undefined,
      ...home.doorThreshold
    };
    context.actors.push(busy);
    for (let i = 0; i < 50; i++) {
      updateCarrier(context, actor, 0.05);
      expect(Math.hypot(actor.x - busy.x, actor.z - busy.z)).toBeGreaterThanOrEqual(
        actorSeparation(actor, busy) - 1e-8
      );
    }
    // A following arrival may approach inside the same hall, but cannot overlap the
    // standing predecessor or deposit its load before reaching the real threshold.
    expect(["deliver", "enterDelivery"]).toContain(actor.phase);
    expect(actor.ware).toBe("logs");
    expect(home.inventory.logs ?? 0).toBe(0);
    expect(home.incoming.logs).toBe(1);
    busy.visible = false;
    // The waiting carrier now walks back from its clear shoulder before entering.
    for (let tick = 0; tick < 200 && actor.phase !== "enterDelivery"; tick++) {
      const previous = { x: actor.x, z: actor.z };
      updateCarrier(context, actor, 0.05);
      expect(Math.hypot(actor.x - previous.x, actor.z - previous.z)).toBeLessThanOrEqual(0.061);
      expect(home.inventory.logs ?? 0).toBe(0);
    }
    expect(actor.phase).toBe("enterDelivery");
    expect(actor.ware).toBe("logs");
    expect(home.inventory.logs ?? 0).toBe(0);
    for (let i = 0; i < 200 && actor.phase !== "inside"; i++) updateCarrier(context, actor, 0.05);
    expect(actor.phase).toBe("inside");
    expect(actor.visible).toBe(false);
    expect(actor.ware).toBeNull();
    expect(home.inventory.logs).toBe(1);
    expect(home.incoming.logs).toBe(0);
    // Storehouses use paired door lanes, so the arrival rests on the inbound lane point.
    const inboundLane = storageDoorLanePoint(home, home.doorThreshold, "in");
    expect(actor.x).toBeCloseTo(inboundLane.x);
    expect(actor.z).toBeCloseTo(inboundLane.z);
  });
  it("leaves the empty carrier visible at production when its return road disappears", () => {
    const { actor, building, context, setBlocked } = fixture();
    actor.job = "Carrier";
    actor.phase = "deliver";
    actor.delivery = { source: 0, destination: building.uid, ware: "planks" };
    actor.ware = "planks";
    Object.assign(actor, building.access);
    building.incoming = { planks: 1 };
    setBlocked(true);
    updateCarrier(context, actor, 0.05);
    expect(building.input.planks ?? 0).toBe(0);
    expect(actor.ware).toBe("planks");
    for (let i = 0; i < 22; i++) updateCarrier(context, actor, 0.05);
    expect(building.input.planks).toBe(1);
    expect(actor.phase).toBe("returnBlockedCarrier");
    expect(actor.visible).toBe(true);
    for (let i = 0; i < 100; i++) updateCarrier(context, actor, 0.05);
    expect(actor.phase).toBe("returnBlockedCarrier");
    expect(actor.x).toBe(building.access.x);
    expect(actor.z).toBe(building.access.z);
    setBlocked(false);
    for (let i = 0; i < 2000 && actor.phase !== "inside"; i++) updateCarrier(context, actor, 0.05);
    expect(actor.phase).toBe("inside");
    expect(actor.visible).toBe(false);
    expect(building.input.planks).toBe(1);
  });
});
