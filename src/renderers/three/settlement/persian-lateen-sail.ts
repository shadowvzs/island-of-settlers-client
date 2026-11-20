import { BufferGeometry, Float32BufferAttribute, type Group, Vector3 } from "three";

import { PERSIAN_LATEEN_SAIL, persianLateenBelly, persianLateenPoint, persianLateenUV } from
  "../../../render-common/ships/persian-lateen-layout";
import { SHIP_CLOTH_WIND } from "../../../render-common/ships/ship-cloth-wind";
import type { ShipKit } from "./ship-kit";
import { CLOTH_STARBOARD, LATEEN_FLUTTER } from "./ship-sails";

/** True triangular tessellation has one clew vertex and no collapsed rectangular-grid triangles. */
export const createPersianLateenSail = (detailed: boolean) => {
  const divisions = detailed ? 14 : 5, vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  const winds: number[] = [];
  const offset = (row: number) => row * (divisions + 1) - row * (row - 1) / 2;
  for (let row = 0; row <= divisions; row++) for (let col = 0; col <= divisions - row; col++) {
    const u = col / divisions, v = row / divisions, point = persianLateenPoint(u, v);
    vertices.push(...point); uv.push(...persianLateenUV(point));
    // The yard (v = 0) and the clew are pinned; the foot and the leech flutter.
    winds.push(CLOTH_STARBOARD, persianLateenBelly(u, v), LATEEN_FLUTTER(v), 1);
    if (row < divisions && col < divisions - row) {
      const a = offset(row) + col, b = a + 1, c = offset(row + 1) + col;
      indices.push(a, c, b);
      if (col < divisions - row - 1) indices.push(b, c, c + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  geometry.setAttribute(SHIP_CLOTH_WIND.attribute, new Float32BufferAttribute(winds, 4));
  geometry.computeVertexNormals();
  return geometry;
};

export const buildPersianLateenYard = (kit: ShipKit, rig: Group) => {
  const { clew, peak, tack, yardX } = PERSIAN_LATEEN_SAIL;
  const from = new Vector3(yardX, tack[1], tack[2]), to = new Vector3(yardX, peak[1], peak[2]);
  const direction = to.clone().sub(from).normalize(), extension = .080;
  const yard = kit.add(rig, "cedar", [.018, from.distanceTo(to) + extension * 2, .018],
    from.clone().add(to).multiplyScalar(.5).toArray());
  yard.geometry = kit.pole; yard.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
  const crossing = tack[1] + (peak[1] - tack[1]) * tack[2] / (tack[2] - peak[2]);
  // A real parrel wraps the mast and yard at their crossing; the yard is hoisted from above.
  kit.curve(rig, "dark", [[yardX, crossing, 0], [.025, crossing, -.037],
    [-.035, crossing, 0], [.025, crossing, .037], [yardX, crossing, 0]], .005,
  kit.detailed ? 12 : 6);
  kit.curve(rig, "dark", [[0, 2.29, 0], [yardX, crossing + .03, 0]], .004, 1);
  for (let index = 0; index <= (kit.detailed ? 8 : 3); index++) {
    const u = index / (kit.detailed ? 8 : 3), point = persianLateenPoint(u, 0);
    kit.curve(rig, "dark", [[yardX + .014, point[1], point[2]], point], .0025, 1);
  }
  if (kit.detailed) {
    // Working stays stay windward, behind this starboard sail and outside the cargo slots.
    // The shared square-rig shrouds would cut through its lower half as they diverged to starboard.
    for (const [x, z] of [[-.375, .58], [-.375, .35], [-.375, -.58], [-.375, -.35]])
      kit.curve(rig, "dark", [[0, 1.74, 0], [x!, .25, z!]], .005, 1);
    kit.curve(rig, "dark", [[0, 2.29, 0], [yardX, peak[1] - .22, peak[2] + .28]], .0035, 1);
    kit.curve(rig, "dark", [clew, [.375, .29, -.90]], .004, 1);
  }
};
