import { BufferGeometry, Group, Mesh } from "three";
import { expect, it } from "vitest";

import { buildChineseShipRig, buildPersianShipRig, createChineseShipSail } from "../src/renderers/three/settlement/expansion-ship-sails";
import { createShipKit } from "../src/renderers/three/settlement/ship-kit";
import { createShipMastFlag } from "../src/renderers/three/settlement/ship-mast-flag";
import { createShipMaterials } from "../src/renderers/three/settlement/ship-materials";
import { SHIP_STYLES } from "../src/renderers/three/settlement/ship-styles";
import { meshTriangleCount, visibleMeshBounds } from "./helpers/visible-mesh-bounds";

it.each([true, false])("Chinese cloth clears the unchanged junk sail even when hanging in calm wind (High=%s)", detailed => {
  const resources = createShipMaterials(), geometries = new Set<BufferGeometry>(), rig = new Group();
  const own = <T extends BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
  const kit = createShipKit(detailed, resources.materials, own, own);
  buildChineseShipRig(kit, rig);
  const mast = rig.children.find(object => object instanceof Mesh && object.geometry === kit.pole
    && object.position.z === 0)!;
  const pole = visibleMeshBounds(mast), sail = createChineseShipSail(detailed);
  sail.computeBoundingBox();
  expect(pole.min.y).toBeCloseTo(.15, 6); // Only the upper mast grows.
  const offset = SHIP_STYLES.chinese.flagOffset!;
  expect(offset[0]).toBe(0); expect(offset[2]).toBe(0);
  expect(pole.max.y).toBeCloseTo(2.35 + offset[1], 6);
  const flag = createShipMastFlag(detailed), cloth = flag.createMesh();
  let lowest = Infinity;
  for (const strength of [0, .25, .6, 1]) for (let step = 0; step < 48; step++) {
    flag.update(step / 48 * 10, strength);
    const positions = cloth.geometry.getAttribute("position");
    for (let vertex = 0; vertex < positions.count; vertex++)
      lowest = Math.min(lowest, positions.getY(vertex) + offset[1]);
  }
  expect(lowest - sail.boundingBox!.max.y).toBeGreaterThan(.10);
  flag.dispose(); sail.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of Object.values(resources.materials)) material.dispose();
  resources.dispose();
});

it.each([true, false])("Persian flag returns to the existing main mast without the retired aft staff (High=%s)", detailed => {
  const resources = createShipMaterials(), geometries = new Set<BufferGeometry>(), rig = new Group();
  const own = <T extends BufferGeometry>(geometry: T) => { geometries.add(geometry); return geometry; };
  const kit = createShipKit(detailed, resources.materials, own, own);
  buildPersianShipRig(kit, rig);
  expect(SHIP_STYLES.persian.flagOffset).toBeUndefined();
  const poles = rig.children.filter(object => object instanceof Mesh && object.geometry === kit.pole);
  expect(poles).toHaveLength(2); // The original vertical mast and the real diagonal lateen yard.
  const mainMast = poles.find(object => Math.abs(object.rotation.z) < 1e-6
    && Math.abs(object.rotation.x) < 1e-6)!;
  expect(visibleMeshBounds(mainMast).max.y).toBeCloseTo(2.35, 6);
  expect(rig.children.some(object => /phoenix|sculpture|perch/i.test(object.name))).toBe(false);
  expect(meshTriangleCount(rig)).toBeLessThan(3000);
  for (const geometry of geometries) geometry.dispose();
  for (const material of Object.values(resources.materials)) material.dispose();
  resources.dispose();
});
