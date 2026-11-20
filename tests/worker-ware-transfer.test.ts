import { Group, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { applyCarriedWareScale, placeTransferredWare } from "../src/renderers/three/worker-ware-transfer";

describe("physical stock transfers", () => {
  for (const rotation of [0, 1, 2, 3]) it(`reaches the exact stock pose at rotation ${rotation}`, () => {
    const root = new Group(); root.scale.setScalar(.916); root.position.set(10, 2, 7);
    root.rotation.y = rotation * Math.PI / 2;
    const prop = new Group(), shape = new Group(); shape.name = "ware_geometry";
    shape.rotation.y = Math.PI / 2; prop.add(shape); root.add(prop);
    prop.position.set(.17, .89, -.025);
    const start = prop.position.clone();
    const scale = { x: 1.2, y: 1.4, z: 1.7 };
    applyCarriedWareScale(prop, root, scale);
    const carryingScale = prop.scale.clone();
    const transfer: NonNullable<WorkerFrame["wareTransfer"]> = {
      direction: "putdown", ware: "grain", progress: 0,
      target: { x: 10.3, y: 2.16, z: 7.4 }, yaw: .8, scale3: scale
    };
    placeTransferredWare(prop, root, transfer);
    expect(prop.position.distanceTo(start)).toBeLessThan(1e-7);
    expect(prop.scale.distanceTo(carryingScale)).toBeLessThan(1e-7);
    for (const progress of [.1, .2, .3, .4, .6, .8, 1]) {
      prop.position.copy(start); prop.quaternion.identity(); prop.scale.copy(carryingScale);
      placeTransferredWare(prop, root, { ...transfer, progress });
      expect([...prop.position.toArray(), ...prop.quaternion.toArray()]
        .every(Number.isFinite)).toBe(true);
    }
    expect(prop.getWorldPosition(new Vector3()).distanceTo(new Vector3(10.3, 2.16, 7.4))).toBeLessThan(1e-7);
    const worldRotation = prop.getWorldQuaternion(new Quaternion()).multiply(shape.quaternion);
    expect(worldRotation.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .8))).toBeLessThan(1e-7);
    const shapeScale = prop.getWorldScale(new Vector3());
    expect(shapeScale.x).toBeCloseTo(scale.z);
    expect(shapeScale.z).toBeCloseTo(scale.x);
    prop.position.copy(start); prop.quaternion.identity(); prop.scale.copy(carryingScale);
    placeTransferredWare(prop, root, { ...transfer, direction: "pickup", progress: 1 });
    expect(prop.position.distanceTo(start)).toBeLessThan(1e-7);
    expect(prop.scale.distanceTo(carryingScale)).toBeLessThan(1e-7);
  });

  it("keeps the actual ware model during one-shot material clips", () => {
    expect(getWorkerHeldProp({ action: "putdown_material", carryingWare: "logs",
      wareTransfer: { direction: "putdown", ware: "logs", progress: .5, target: { x: 1, y: 0, z: 2 } }
    })).toEqual({ id: "logs", source: "ware" });
  });
});
