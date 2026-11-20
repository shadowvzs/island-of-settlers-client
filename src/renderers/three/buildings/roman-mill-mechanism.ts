import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
} from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { ROMAN_MILL_ROTOR_SCALE } from "../../../render-common/buildings/roman-mill-dimensions";
import { createFinishedMillSailTexture } from "./mill-sail-cloth";

const ROMAN_SAIL_OUTLINE = [[-.21, -.69], [.21, -.69], [.21, .69], [-.21, .69]] as const;

/** Linen weave with subtle straight bound edges; no visible dash stitching. */
const createLinenTexture = (detailed: boolean) => createFinishedMillSailTexture(ROMAN_SAIL_OUTLINE,
  detailed, (u, v) => {
    const weave = Math.cos(u * Math.PI * 96) * 4 + Math.cos(v * Math.PI * 192) * 4;
    const fibre = Math.sin(u * 690 + v * 330) * 3;
    const weather = Math.sin(u * 11.5) * Math.sin(v * 7.4) * 8, value = weave + fibre + weather;
    return [222 + value, 207 + value, 174 + value];
  }, "roman-linen", false);

/** Four framed linen sails; geometry and neutral cloth material export directly to GLB. */
export const createRomanMillMechanism = (
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean
) => {
  const root = new Group();
  root.name = "mechanism";
  const add = (geometry: BufferGeometry, material: MeshStandardMaterial) => {
    geometry.scale(ROMAN_MILL_ROTOR_SCALE, ROMAN_MILL_ROTOR_SCALE, ROMAN_MILL_ROTOR_SCALE);
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3).fill(1),
        3
      )
    );
    const object = new Mesh(geometry, material);
    object.castShadow = detailed;
    root.add(object);
    return object;
  };
  const hub = add(new CylinderGeometry(0.075, 0.075, 0.2, 8), materials.iron);
  hub.rotation.x = Math.PI / 2;
  const cloth = materials.cloth.clone();
  cloth.map = createLinenTexture(detailed);
  cloth.color.setRGB(1, 1, 1);
  cloth.roughness = 0.95;
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    const arm = add(new BoxGeometry(0.045, 1.94, 0.045), materials.wood);
    arm.position.set(Math.sin(angle) * 0.97, Math.cos(angle) * 0.97, 0.02);
    arm.rotation.z = -angle;
    const sail = add(new BoxGeometry(.42, 1.38, .009), cloth);
    sail.position.set(
      Math.sin(angle) * 1.23 + Math.cos(angle) * 0.17,
      Math.cos(angle) * 1.23 - Math.sin(angle) * 0.17,
      0.045
    );
    sail.rotation.z = -angle;
    sail.name = `mill_cloth_sail_${i}`;
    if (i === 0) {
      sail.userData.ownedMaterial = true;
      sail.userData.ownedMap = true;
    }
    const timber = (across: number, along: number, w: number, h: number) => {
      const brace = add(new BoxGeometry(w, h, 0.025), materials.wood);
      brace.position.set(
        sail.position.x + Math.cos(angle) * across + Math.sin(angle) * along,
        sail.position.y - Math.sin(angle) * across + Math.cos(angle) * along,
        0.058
      );
      brace.rotation.z = -angle;
    };
    for (const side of [-1, 1]) timber(side * 0.21, 0, 0.022, 1.42);
    const ribs = detailed ? 8 : 4;
    for (let rib = 0; rib < ribs; rib++) timber(0, -0.69 + (rib * 1.38) / (ribs - 1), 0.46, 0.018);
  }
  for (const child of root.children) child.position.multiplyScalar(ROMAN_MILL_ROTOR_SCALE);
  return root;
};
