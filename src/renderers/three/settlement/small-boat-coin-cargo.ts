import { BoxGeometry, Color, Float32BufferAttribute, Group, InstancedMesh, Matrix4, type MeshStandardMaterial } from "three";

import type { CargoBox } from "../../../shared/settlement/ship-cargo-boxes";
import { createCoinChestInstances } from "./coin-chest-instances";
import { BARGE_DRY_FLOOR_Y } from "./harbour-barge-geometry";

/** The same four-box capacity: two supported stacks keep full-size chests clear of the stern rower. */
export const createSmallBoatCoinCargo = (detailed: boolean) => {
  const chests = createCoinChestInstances(detailed);
  const geometry = new BoxGeometry(.3, .26, .3), tint = new Color(0xb1a384);
  const colors = new Float32Array(geometry.attributes.position!.count * 3);
  for (let index = 0; index < colors.length; index += 3) colors.set([tint.r, tint.g, tint.b], index);
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const create = (material: MeshStandardMaterial) => {
    const root = new Group(), coin = chests.create(4, 1, true);
    const regular = new InstancedMesh(geometry, material, 4), matrix = new Matrix4();
    root.name = "small_boat_coin_cargo"; regular.count = 0; root.add(regular, coin.root);
    const update = (manifest: readonly CargoBox[], opacity = 1) => {
      const cargo = manifest.slice(0, 4), hasCoins = cargo.some(box => box.ware === "coins");
      root.visible = hasCoins;
      if (!hasCoins) { regular.count = 0; coin.update([]); return false; }
      const heights = [BARGE_DRY_FLOOR_Y, BARGE_DRY_FLOOR_Y], places = [];
      let boxes = 0;
      for (let index = 0; index < cargo.length; index++) {
        const row = index % 2, z = row === 0 ? -.035 : .405, y = heights[row]!;
        if (cargo[index]!.ware === "coins") {
          places.push({ x: 0, y, z }); heights[row] = y + chests.height();
        } else {
          regular.setMatrixAt(boxes++, matrix.makeTranslation(0, y + .13, z)); heights[row] = y + .26;
        }
      }
      regular.count = boxes; regular.instanceMatrix.needsUpdate = true;
      if (boxes) regular.computeBoundingSphere();
      coin.update(places, opacity); return true;
    };
    return { root, update, dispose: () => { regular.dispose(); coin.dispose(); root.clear(); root.removeFromParent(); } };
  };
  return { create, dispose: () => { geometry.dispose(); chests.dispose(); } };
};
