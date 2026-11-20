import { Box3, type Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { ShipSiteFrame } from "../src/render-common/ships/ship-frame";
import { createThreeShipWorkPiers } from "../src/renderers/three/settlement/three-ship-work-piers";
import { createHarbourDocks } from "../src/shared/settlement/settlement-harbour-docks";
import { createHarbourPiers } from "../src/shared/settlement/settlement-harbour-piers";
import { createNavalFleet } from "../src/shared/settlement/settlement-naval-fleet";
import { createShipSea, SHIP_TICK } from "./helpers/ship-motion-scenarios";

/** Permanent harbour piers (NAV-02): one per berth from harbour completion, the docking pier's pose. */
const harbourScene = (rotation = 0) => {
  // Level 3 (saved level 2) gives both harbours a second berth where the open coast allows.
  const sea = createShipSea(), source = sea.harbour(20, 15, rotation, 2), destination = sea.harbour(90, 15, 0, 2);
  const fleet = createNavalFleet(sea.context, sea.sea);
  const piers = createHarbourPiers(sea.context, fleet.harbourBerths);
  return { context: sea.context, destination, fleet, piers, source };
};
const meshNamed = (group: { children: readonly unknown[] }, name: string) =>
  (group.children as Mesh[]).find(child => child.name === name);
const triangles = (mesh: Mesh) => (mesh.geometry.index?.count ?? mesh.geometry.attributes.position!.count) / 3;

describe("harbour piers", () => {
  it.each([true, false])("keeps sloping decks upright at every compass heading (detailed=%s)", detailed => {
    const material = new MeshStandardMaterial();
    for (const yaw of [0, .1, Math.PI / 4, Math.PI / 2, Math.PI - .1, Math.PI, Math.PI * 1.25, -Math.PI / 2]) {
      const view = createThreeShipWorkPiers(material, detailed);
      const work = { contact: { x: Math.sin(yaw) * 3.2, z: Math.cos(yaw) * 3.2 },
        point: { x: Math.sin(yaw) * 3, z: Math.cos(yaw) * 3 }, shore: { x: 0, z: 0 }, shoreY: .6, y: .18 };
      view.update([{ id: 1, kind: "pier", progress: 1, workPier: work, x: 0, y: 0, yaw, z: 0 }]);
      const geometry = meshNamed(view.group, "harbour_piers")!.geometry;
      // The first box's +Y face is the deck top. It must follow the walking grade without banking.
      const normal = new Vector3().fromBufferAttribute(geometry.attributes.normal!, 8);
      expect(normal.y).toBeGreaterThan(.98);
      expect(geometry.attributes.normal!.getY(0)).toBeCloseTo(0, 6);
      expect(normal.dot(new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)))).toBeCloseTo(0, 6);
      const centre = new Vector3();
      for (let vertex = 8; vertex < 12; vertex++) centre.add(new Vector3().fromBufferAttribute(geometry.attributes.position!, vertex));
      centre.divideScalar(4);
      const fraction = Math.hypot(centre.x, centre.z) / 3;
      expect(centre.y).toBeCloseTo(work.shoreY + (work.y - work.shoreY) * fraction, 6);
      view.dispose();
    }
    material.dispose();
  });

  it("keeps defensive zero-length and vertical workpoint geometry finite", () => {
    const material = new MeshStandardMaterial(), view = createThreeShipWorkPiers(material, true);
    for (const y of [0, 3]) {
      const work = { contact: { x: 0, z: 0 }, point: { x: 0, z: 0 }, shore: { x: 0, z: 0 }, shoreY: 0, y };
      view.update([{ id: y + 1, kind: "pier", progress: 1, workPier: work, x: 0, y: 0, yaw: 0, z: 0 }]);
      const positions = meshNamed(view.group, "harbour_piers")!.geometry.attributes.position!;
      expect([...positions.array].every(Number.isFinite)).toBe(true);
    }
    view.dispose(); material.dispose();
  });

  it.each([0, 1, 2, 3])("stands at every berth (harbour turned %i quarter turns); a docking ship uses it", rotation => {
    const { context, destination, fleet, piers, source } = harbourScene(rotation);
    const frames = piers();
    expect(frames.length).toBe(fleet.harbourBerths(source.uid).length + fleet.harbourBerths(destination.uid).length);
    expect(frames.every(frame => frame.kind === "pier" && frame.workPier)).toBe(true);
    expect(piers()).toBe(frames);
    // A ship docks at the source berth: its own pier is the harbour pier (same shore, same pier end).
    source.inventory = { stone: 5 };
    fleet.addShip({ x: 40.5, z: 40.5 }, 0);
    expect(fleet.queueTransport(source.uid, destination.uid, { stone: 5 })).not.toBeNull();
    const docks = createHarbourDocks(context);
    let docked: ShipSiteFrame | undefined;
    for (let tick = 0; tick < 600 / SHIP_TICK && !docked; tick++) {
      fleet.update(SHIP_TICK);
      docked = docks(fleet.snapshot(), fleet.frames())[0];
    }
    const pier = frames.find(frame => frame.workPier!.shore.x === docked!.workPier!.shore.x &&
      frame.workPier!.shore.z === docked!.workPier!.shore.z)!;
    expect(pier).toBeDefined();
    expect(Math.hypot(pier.workPier!.point.x - docked!.workPier!.point.x,
      pier.workPier!.point.z - docked!.workPier!.point.z)).toBeLessThan(.3);
  }, 60000);

  it("rebuilds the permanent piers when a level 1 harbour reaches level 3 and gains its second berth", () => {
    const sea = createShipSea(), harbour = sea.harbour(60, 15, 0, 0);
    const fleet = createNavalFleet(sea.context, sea.sea), piers = createHarbourPiers(sea.context, fleet.harbourBerths);
    expect(fleet.harbourBerths(harbour.uid)).toHaveLength(1);
    const before = piers();
    expect(before).toHaveLength(1);
    // Level 3 (saved level 2) adds the second berth; no world revision is bumped by hand.
    harbour.workshopUpgrade = { level: 2 };
    expect(fleet.harbourBerths(harbour.uid)).toHaveLength(2);
    const after = piers();
    expect(after).toHaveLength(2);
    expect(after).not.toBe(before);
    expect(after[1]!.id).toBe(before[0]!.id + 1);
    expect(after.every(frame => frame.kind === "pier" && frame.workPier)).toBe(true);
  });

  it("draws a dedicated boat jetty as a narrow fixed board, never as a ship ramp", () => {
    const sea = createShipSea(), harbour = sea.harbour(20, 15), fleet = createNavalFleet(sea.context, sea.sea);
    expect(harbour.uid).toBeGreaterThan(0);
    const jetty = fleet.shuttleJetties();
    expect(jetty.length).toBeGreaterThan(0);
    const view = createThreeShipWorkPiers(new MeshStandardMaterial(), true);
    view.update(jetty);
    const deck = meshNamed(view.group, "harbour_piers")!;
    expect(deck).toBeDefined();
    expect(view.group.children).toHaveLength(1);
    const bounds = new Box3().setFromObject(deck);
    expect(Math.min(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z)).toBeLessThan(1);
    expect(triangles(deck)).toBeLessThanOrEqual(600);
    view.dispose();
  });

  it("draws the fixed pier a tile short of the hull and the gangway only while a ship lies there", () => {
    const { piers } = harbourScene();
    const pier = piers()[0]!, work = pier.workPier!;
    const dock: ShipSiteFrame = { ...pier, id: 1_000_001, kind: "dock" };
    for (const detailed of [true, false]) {
      const view = createThreeShipWorkPiers(new MeshStandardMaterial(), detailed);
      view.update([pier]);
      const deck = meshNamed(view.group, "harbour_piers")!;
      expect(view.group.children).toHaveLength(1);
      // The deck ends a tile short of the pier end; nothing of it reaches the hull side.
      const bounds = new Box3().setFromObject(deck);
      const end = { x: work.point.x, z: work.point.z };
      const nearest = Math.hypot(Math.max(bounds.min.x - end.x, 0, end.x - bounds.max.x),
        Math.max(bounds.min.z - end.z, 0, end.z - bounds.max.z));
      expect(nearest).toBeGreaterThan(.5);
      expect(triangles(deck)).toBeLessThanOrEqual(detailed ? 600 : 120);
      view.update([pier, dock]);
      expect(meshNamed(view.group, "harbour_piers")).toBe(deck);
      expect(meshNamed(view.group, `ship_work_pier_${dock.id}`)).toBeDefined();
      view.update([pier]);
      expect(view.group.children).toHaveLength(1);
      view.dispose();
    }
  });
});
