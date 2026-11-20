import { describe, expect, it } from "vitest";

import { getAuthoredBuildingPlot } from "../src/render-common/buildings/building-plot-profile";
import { CATAPULT_DECK_HEIGHT } from "../src/render-common/buildings/catapult-dimensions";
import { CATAPULT_RESUPPLY_ROOF_ROUTE, catapultStockAnchor } from "../src/shared/settlement/catapult-cycle";
import { CATAPULT_SUPPLY_SECONDS, type CatapultSupply } from "../src/shared/settlement/military-catapult-resupply";
import {
  type CatapultSupplyLayout, createCatapultResupplyActors
} from "../src/shared/settlement/military-catapult-resupply-actors";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

const layout: CatapultSupplyLayout = { roofRoute: CATAPULT_RESUPPLY_ROOF_ROUTE, rackStone: catapultStockAnchor };
const stairsSeconds = CATAPULT_SUPPLY_SECONDS["stairs-up"];
const session = (rotation = 0) => {
  const porter = { actor: 2, carrying: true, elapsed: 0, phase: "stairs-up" as const };
  const site = { uid: 1, worker: 2, typeId: 16, construction: 1, rotation, x: 10, y: 2, z: 10,
    doorThreshold: { x: 10, z: 11 }, input: { stone: 0 }, incoming: {},
    catapultSupply: { ground: 0, porter } as CatapultSupply } as unknown as SettlementBuilding;
  const actor = { uid: 2, job: "Carrier", building: 1, home: 3, phase: "catapultResupply", x: 10, y: 2, z: 11,
    visible: false, ware: "stone", path: [], pathIndex: 0, timer: 0, animationTime: 0, yaw: 0,
    action: "idle" } as SettlementActor;
  const context = { actors: [actor], buildings: [site], options: {} } as unknown as SettlementContext;
  const recovered: { x: number; y: number; z: number }[] = [];
  let safe = true;
  const options = { layout, isStanding: () => true, threatened: () => false, roofSafe: () => safe,
    releaseCargo: (_site: SettlementBuilding, _porter: unknown, body: SettlementActor | undefined) => {
      if (body) recovered.push({ x: body.x, y: body.y, z: body.z });
    } };
  const service = createCatapultResupplyActors(context, options);
  return { actor, context, options, recovered, service, site, setSafe: (value: boolean) => { safe = value; } };
};

describe("Real Catapult roof porter actor", () => {
  it("waits inside and emerges at the rotated, correctly scaled hatch after the stairs timer", () => {
    const { actor, service, setSafe, site } = session(1), scale = getAuthoredBuildingPlot(16)!.structureScale;
    setSafe(false); service.update(100);
    expect(actor.visible).toBe(false); expect(actor.y).toBe(site.y);
    expect(site.catapultSupply!.porter!.elapsed).toBe(0);
    setSafe(true); service.update(stairsSeconds);
    expect(actor.visible).toBe(true); expect(actor.phase).toBe("catapultResupply");
    expect(actor.x).toBeCloseTo(site.x + layout.roofRoute[0]![2] * scale);
    expect(actor.z).toBeCloseTo(site.z - layout.roofRoute[0]![0] * scale);
    expect(actor.y).toBeCloseTo(site.y + CATAPULT_DECK_HEIGHT * scale);
    expect(service.updateActor(actor)).toBe(true);
    expect(service.owns(2)).toBe(true);
  });

  it("walks the real body at bounded speed, puts its one stone down, and returns the same identity", () => {
    const { actor, context, service, site } = session(); service.update(stairsSeconds);
    const from = { x: actor.x, z: actor.z }; service.update(.1);
    expect(Math.hypot(actor.x - from.x, actor.z - from.z)).toBeCloseTo(.065);
    expect(actor.ware).toBe("stone"); expect(site.input.stone).toBe(0);
    for (let tick = 0; tick < 400; tick++) service.update(.05);
    expect(site.input.stone).toBe(1); expect(site.catapultSupply!.porter).toBeUndefined();
    expect(context.actors).toHaveLength(1); expect(context.actors[0]!.uid).toBe(2);
    expect(actor.phase).toBe("inside"); expect(actor.visible).toBe(false);
    expect(actor.ware).toBeNull();
    expect(service.owns(2)).toBe(false);
  });

  it("emerges progressively through the open hatch and descends below it before disappearing", () => {
    const { actor, service, site } = session(), scale = getAuthoredBuildingPlot(16)!.structureScale;
    const floor = site.y + CATAPULT_DECK_HEIGHT * scale;
    service.update(stairsSeconds * .5); expect(actor.visible).toBe(false);
    service.update(stairsSeconds * .25); expect(actor.visible).toBe(true);
    expect(actor.y).toBeGreaterThan(site.y); expect(actor.y).toBeLessThan(floor);
    const lastStairHeight = actor.y; service.update(stairsSeconds * .225);
    expect(actor.y).toBeGreaterThan(lastStairHeight); expect(actor.y).toBeLessThan(floor);
    service.update(stairsSeconds * .025); expect(actor.y).toBeCloseTo(floor);
    for (let tick = 0; tick < 100 && site.catapultSupply?.porter?.phase !== "stairs-down"; tick++)
      service.update(.05);
    expect(site.catapultSupply!.porter!.phase).toBe("stairs-down");
    expect(actor.visible).toBe(true); service.update(stairsSeconds * .15);
    expect(actor.y).toBeLessThan(floor); expect(actor.visible).toBe(true);
    service.update(stairsSeconds * .5); expect(actor.visible).toBe(false);
    expect(actor.y).toBeGreaterThan(site.y);
  });

  it("preserves actual saved roof position and resumes without replaying the hatch emergence", () => {
    const original = session(); original.service.update(stairsSeconds); original.service.update(.15);
    const saved = structuredClone(original.context);
    const restored = createCatapultResupplyActors(saved, original.options);
    for (let tick = 0; tick < 150; tick++) {
      original.service.update(.05); restored.update(.05);
      expect(saved.actors).toEqual(original.context.actors);
      expect(saved.buildings).toEqual(original.context.buildings);
    }
  });

  it("releases casualty cargo once at the real actor location without returning it to the pile", () => {
    const { actor, recovered, service, site } = session(); service.update(stairsSeconds); service.update(.1);
    const location = { x: actor.x, y: actor.y, z: actor.z };
    service.release(site, actor); service.release(site, actor);
    expect(recovered).toEqual([location]); expect({ x: actor.x, y: actor.y, z: actor.z }).toEqual(location);
    expect(site.catapultSupply!.ground).toBe(0); expect(site.input.stone).toBe(0);
    expect(site.catapultSupply!.porter).toBeUndefined(); expect(actor.ware).toBeNull();
  });
});
