import type { BufferAttribute, BufferGeometry } from "three";

import { SHIP_CLOTH_WIND, shipClothPoint, type ShipClothWindState,
  type ShipClothWindVertex } from "../../src/render-common/ships/ship-cloth-wind";

/** Calm and storm wind from astern, abeam (both sides) and ahead, at several moments. */
export const SHIP_CLOTH_TEST_WINDS: readonly ShipClothWindState[] = [0, 1].flatMap(strength =>
  [[0, 1], [1, 0], [-1, 0], [0, -1]].flatMap(([localX, localZ]) =>
    [0, 1.3, 2.7, 8.2].map(time => ({ localX: localX!, localZ: localZ!, phase: .4, strength, time }))));

/** The sail cloth as the SHIP-WIND shader deforms it in `state` (CPU reference), written into `out`. */
export const deformShipCloth = (geometry: BufferGeometry, state: ShipClothWindState, out: BufferAttribute) => {
  const rest = geometry.getAttribute("position"), wind = geometry.getAttribute(SHIP_CLOTH_WIND.attribute);
  for (let index = 0; index < rest.count; index++) {
    const vertex = [0, 1, 2, 3].map(item => wind.getComponent(index, item)) as unknown as ShipClothWindVertex;
    out.setXYZ(index, ...shipClothPoint([rest.getX(index), rest.getY(index), rest.getZ(index)], vertex, state));
  }
  return out;
};
