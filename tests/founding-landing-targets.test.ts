import { Box3, Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { createThreeShipWorkPiers } from "../src/renderers/three/settlement/three-ship-work-piers";
import { foundingLandingFrame, foundingLandingTargets } from "../src/shared/settlement/settlement-founding-landing";
import type { ShipWorkpoint } from "../src/shared/settlement/settlement-ship-workpoint";

const site = (x: number, z: number, accessX: number, accessZ: number) => ({
  access: { x: accessX, z: accessZ }, x, z
});

it("puts the landing crew outside the site on the access side", () => {
  const north = foundingLandingTargets(site(10, 10, 10.5, 6.5), 3);
  expect(north.every(target => target.z < 6.5)).toBe(true);
  expect(north.map(target => target.z.toFixed(2))).toEqual(["5.50", "5.50", "5.50"]);

  const east = foundingLandingTargets(site(10, 10, 13.5, 10.5), 3);
  expect(east.every(target => target.x > 13.5)).toBe(true);

  const south = foundingLandingTargets(site(10, 10, 10.5, 13.5), 3);
  expect(south.every(target => target.z > 13.5)).toBe(true);

  const west = foundingLandingTargets(site(10, 10, 6.5, 10.5), 3);
  expect(west.every(target => target.x < 6.5)).toBe(true);
});

it("spreads the crew along the wall instead of into the building plot", () => {
  const targets = foundingLandingTargets(site(10, 10, 10.5, 6.5), 3);
  expect(targets.map(target => target.x)).toEqual([9.85, 10.5, 11.15]);
  expect(new Set(targets.map(target => target.z)).size).toBe(1);
});

it("draws the founding landing as a dock whose gangway reaches the hull", () => {
  const work: ShipWorkpoint = { contact: { x: 0, z: 8.4 }, point: { x: 0, z: 8 },
    shore: { x: 0, z: 0 }, shoreY: .3, y: .82 };
  const frame = foundingLandingFrame(1, { x: 0, y: 0, yaw: 0, z: 8.4 } as never,
    { paths: [], pier: work });
  expect(frame.kind).toBe("dock");
  const view = createThreeShipWorkPiers(new MeshStandardMaterial(), true);
  try {
    view.update([frame]);
    const dock = view.group.children.find(child => child instanceof Mesh && child.name.startsWith("ship_work_pier_"));
    expect(dock).toBeInstanceOf(Mesh);
    const bounds = new Box3().setFromObject(dock!);
    expect(bounds.max.z).toBeGreaterThan(work.point.z);
  } finally {
    view.dispose();
  }
});
