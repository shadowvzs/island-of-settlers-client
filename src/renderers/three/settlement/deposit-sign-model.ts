import { BoxGeometry, type BufferGeometry, Float32BufferAttribute, Group, Mesh, type MeshStandardMaterial, PlaneGeometry } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { ORE, type Ore } from "../../../shared/world/world-data";

export const DEPOSIT_NAMES: Partial<Record<Ore, string>> = {
  [ORE.coal]: "Coal deposit", [ORE.iron]: "Iron deposit",
  [ORE.gold]: "Gold deposit", [ORE.granite]: "Granite deposit"
};
/** Timber survey marker with flat shaded ore artwork painted onto both board faces. */
export const createDepositSignModel = (
  materials: Record<BuildingSurface, MeshStandardMaterial>, painting: MeshStandardMaterial
) => {
  const root = new Group();
  const timber = materials.wood;
  const wood: BufferGeometry[] = [];
  const box = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
    const geometry = new BoxGeometry(width, height, depth);
    geometry.setAttribute("color", new Float32BufferAttribute(
      new Float32Array(geometry.getAttribute("position").count * 3).fill(1), 3));
    geometry.translate(x, y, z);
    wood.push(geometry);
  };
  box(.075, .98, .075, 0, .49, -.065);
  box(.54, .39, .065, 0, .87, 0);
  box(.59, .045, .085, 0, 1.075, 0);
  box(.59, .045, .085, 0, .665, 0);
  root.add(new Mesh(mergeGeometries(wood)!, timber));
  for (const piece of wood) piece.dispose();
  const front = new PlaneGeometry(.46, .33).translate(0, .87, .034);
  const back = new PlaneGeometry(.46, .33).rotateY(Math.PI).translate(0, .87, -.034);
  const picture = new Mesh(mergeGeometries([front, back])!, painting);
  picture.name = "deposit_ore_painting";
  root.add(picture);
  front.dispose(); back.dispose();
  root.rotation.y = Math.PI / 4;
  return root;
};
