import { type BufferAttribute, Vector3 } from "three";
import { expect, it } from "vitest";

import { PERSIAN_LATEEN_SAIL, persianLateenPoint, persianLateenUV } from
  "../src/render-common/ships/persian-lateen-layout";
import { SHIP_CLOTH_WIND } from "../src/render-common/ships/ship-cloth-wind";
import { createPersianLateenSail } from "../src/renderers/three/settlement/persian-lateen-sail";
import { deformShipCloth, SHIP_CLOTH_TEST_WINDS } from "./helpers/ship-cloth-deform";

it.each([true, false])("Persian sail is a supported triangle with no collapsed faces, High=%s", detailed => {
  const geometry = createPersianLateenSail(detailed);
  const indices = geometry.getIndex()!, rest = geometry.getAttribute("position");
  const wind = geometry.getAttribute(SHIP_CLOTH_WIND.attribute), positions = (rest as BufferAttribute).clone();
  expect(indices.count / 3).toBe(detailed ? 196 : 25);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
  for (const state of SHIP_CLOTH_TEST_WINDS) {
    deformShipCloth(geometry, state, positions);
    for (let triangle = 0; triangle < indices.count; triangle += 3) {
      a.fromBufferAttribute(positions, indices.getX(triangle));
      b.fromBufferAttribute(positions, indices.getX(triangle + 1));
      c.fromBufferAttribute(positions, indices.getX(triangle + 2));
      expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(1e-7);
    }
    // The luff stays on the diagonal yard and the clew on its sheet in every wind.
    for (let index = 0; index < rest.count; index++) {
      if (wind.getY(index) || wind.getZ(index)) continue;
      expect(positions.getX(index)).toBeCloseTo(rest.getX(index), 6);
      expect(positions.getZ(index)).toBeCloseTo(rest.getZ(index), 6);
    }
  }
  const corners = [persianLateenPoint(1, 0), persianLateenPoint(0, 0), persianLateenPoint(0, 1)];
  expect(corners).toEqual([PERSIAN_LATEEN_SAIL.peak, PERSIAN_LATEEN_SAIL.tack, PERSIAN_LATEEN_SAIL.clew]);
  // The luff is fixed to the diagonal yard: no belly and no flutter weight.
  for (let index = 0; index < rest.count; index++)
    if (Math.abs(rest.getX(index) - PERSIAN_LATEEN_SAIL.peak[0]) < 1e-9) expect(wind.getY(index)).toBe(0);
  geometry.dispose();
});

it("phoenix UVs follow physical height and fore-aft position rather than pinching at the clew", () => {
  for (const point of [[.1, 1.2, -.5], [.2, 1.2, .5]])
    expect(persianLateenUV(point)[1]).toBeCloseTo((1.2 - .70) / 1.52);
  for (const value of persianLateenUV(PERSIAN_LATEEN_SAIL.peak)) expect(value).toBeCloseTo(1);
  expect(persianLateenUV(PERSIAN_LATEEN_SAIL.clew)[0]).toBeGreaterThan(.9);
});
