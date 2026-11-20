import { describe, expect, it } from "vitest";

import { createCommanderPossessionController } from "../src/app/settlement/commander-possession-controller";
import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { huntingWorld } from "./helpers/hunting-world";

const fixture = () => {
  const world = huntingWorld(), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ clockStart: 0, developmentAllowed: true,
    initialSettlers: 20, playerLevel: () => 23, roads, world,
    initialStock: { beer: 40, coins: 40, wine: 40, planks: 40, shield: 6, stone: 40, sword: 6 } });
  const [width, depth] = getBuildingDefinition(62).gridFootprint;
  const placed = simulation.placeBuilding(62, 26 + width / 2, 22 + depth / 2);
  if (!placed.ok || !placed.building) throw new Error(placed.reason);
  Object.assign(placed.building, { construction: 1, foundationProgress: 1, required: {} });
  roads.addRoad(simulation.headquarters.access, placed.building.access);
  expect(simulation.recruitCommander(placed.building.uid).ok).toBe(true);
  let allowed = true;
  const controller = createCommanderPossessionController(simulation, () => allowed);
  return { simulation, controller, deny: () => { allowed = false; } };
};

describe("commander possession application controller", () => {
  it("walks the actual commander out of its lodge before entering and feeds every fixed tick", () => {
    const { controller, simulation } = fixture();
    const original = simulation.saveState(), soldier = simulation.militarySoldiers().find(row => row.commanderId)!;
    expect(controller.enter()).toEqual({ ok: true });
    expect(controller.preparing()).toBe(true);
    expect(simulation.commanderControlSnapshot()).toBeNull();
    for (let tick = 0; tick < 1000 && !controller.active(); tick++) simulation.update(.05);
    expect(controller.notice()).toBeUndefined(); expect(controller.active()).toBe(true);
    const initial = controller.snapshot()!;
    expect(initial.actor).toBe(soldier.actor);
    const actor = simulation.frames().find(row => row.uid === soldier.actor)!;
    expect(actor.phase).toBe("militaryField");
    controller.setMovement(1, 0);
    // A slow render frame steps several simulation ticks; input still renews before lease expiry.
    for (let frame = 0; frame < 5; frame++) simulation.update(.5);
    expect(controller.active()).toBe(true);
    expect(Math.hypot(controller.snapshot()!.x - initial.x, controller.snapshot()!.z - initial.z)).toBeGreaterThan(.5);
    expect(simulation.saveState().actors.filter(row => row.uid === soldier.actor)).toHaveLength(1);
    for (const actor of original.actors)
      expect(simulation.saveState().actors.filter(row => row.uid === actor.uid)).toHaveLength(1);
    expect(simulation.militarySoldiers().find(row => row.actor === soldier.actor)!.combat!.mount)
      .toBe(soldier.combat!.mount);
    controller.dispose(); expect(simulation.commanderControlSnapshot()).toBeNull();
  });

  it("cancels pending entry without teleporting home and clears the authoritative lease on permission loss", () => {
    const { controller, deny, simulation } = fixture();
    expect(controller.enter().ok).toBe(true); controller.leave();
    expect(controller.preparing()).toBe(false);
    for (let tick = 0; tick < 1000; tick++) simulation.update(.05);
    expect(controller.active()).toBe(false);
    expect(simulation.commanderSnapshot()!.location).toBe("field");
    expect(controller.enter().ok).toBe(true);
    deny(); simulation.update(.05);
    expect(controller.active()).toBe(false); expect(simulation.commanderControlSnapshot()).toBeNull();
    controller.dispose(); controller.dispose();
  });

  it("moves the render camera immediately while the body waits for the next tick", () => {
    const { controller, simulation } = fixture();
    controller.enter();
    for (let tick = 0; tick < 1000 && !controller.active(); tick++) simulation.update(.05);
    const bodyYaw = controller.snapshot()!.yaw, viewYaw = controller.view()!.yaw;
    controller.setLook(12, 0, 1 / 60);
    expect((controller.view()!.yaw - viewYaw + Math.PI * 2) % (Math.PI * 2)).toBeCloseTo(.2, 6);
    expect(controller.snapshot()!.yaw).toBe(bodyYaw);
    controller.dispose();
  });

  it.each([30, 60, 144])("accumulates the same look delta at %i FPS", fps => {
    const { controller, simulation } = fixture();
    controller.enter();
    for (let tick = 0; tick < 1000 && !controller.active(); tick++) simulation.update(.05);
    const start = controller.snapshot()!.yaw;
    for (let frame = 0; frame < fps; frame++) {
      controller.setLook(1, 0, 1 / fps);
      simulation.update(1 / fps);
    }
    for (let tick = 0; tick < 30; tick++) simulation.update(.05);
    const turned = (controller.snapshot()!.yaw - start + Math.PI * 2) % (Math.PI * 2);
    expect(turned).toBeCloseTo(1, 1);
    controller.dispose();
  });

  it("retains a brief dismount/call-horse press until the next fixed tick, without replaying it", () => {
    const { controller, simulation } = fixture();
    expect(controller.enter().ok).toBe(true);
    for (let tick = 0; tick < 1000 && !controller.active(); tick++) simulation.update(.05);
    expect(controller.snapshot()!.mounted).toBe(true);
    controller.action("dismount", true); controller.action("dismount", false);
    simulation.update(.05); simulation.update(.05);
    expect(controller.snapshot()!.mounted).toBe(false);
    const mount = simulation.militarySoldiers().find(row => row.commanderId)!.combat!.mount;
    controller.action("callHorse", true); controller.action("callHorse", false);
    for (let tick = 0; tick < 100 && !controller.snapshot()!.mounted; tick++) simulation.update(.05);
    expect(controller.snapshot()!.mounted).toBe(true);
    expect(simulation.militarySoldiers().find(row => row.commanderId)!.combat!.mount).toBe(mount);
    for (let tick = 0; tick < 15; tick++) simulation.update(.05);
    expect(controller.snapshot()!.mounted).toBe(true);
    controller.dispose();
  });
});
