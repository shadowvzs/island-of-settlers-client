import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
  VectorKeyframeTrack} from "three";

import type { BuildingSurface } from "../../../render-common/buildings/building-recipe";
import { createRomanBevelledBox } from "./roman-bevelled-box";

export const createIndustryMechanism = (
  id: number,
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean
) => {
  if (![23, 24, 25, 26, 32, 34].includes(id)) return undefined;
  const root = new Group();
  root.name = "mechanism";
  // The armorer carries the working hammer. The old generic block-and-stem mechanism sat
  // upright inside the anvil face even while idle and looked like a second merged anvil.
  if (id === 24) return root;
  const mesh = (
    name: string,
    geometry: BufferGeometry,
    surface: BuildingSurface,
    position: [number, number, number]
  ) => {
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position!.count * 3).fill(1),
        3
      )
    );
    const object = new Mesh(geometry, materials[surface]);
    object.name = name;
    object.position.set(...position);
    object.castShadow = detailed;
    root.add(object);
    return object;
  };
  if (id === 23) {
    mesh("brewing_paddle", new CylinderGeometry(0.009, 0.012, 0.25, detailed ? 8 : 5),
      "wood", [0, 0.035, 0]);
    mesh("brewing_paddle_grip", new CylinderGeometry(0.013, 0.013, 0.07, detailed ? 8 : 5),
      "wood", [0, 0.145, 0]).rotation.z = Math.PI / 2;
  }
  if (id === 34) {
    // At the lowest stroke the horizontal working face meets the die at world y=.80.
    // The handle enters the head and its butt remains above the bench through the full stroke.
    mesh("mint_hammer_head", createRomanBevelledBox(detailed).scale(.14, .08, .08),
      "steel", [0, -.24, -.06]);
    mesh("mint_hammer_handle", new CylinderGeometry(.011, .014, .24, detailed ? 8 : 5),
      "wood", [.135, -.313, -.06]).rotation.z = .915;
  }
  if (id === 25) {
    mesh(
      "tool_hammer_head",
      createRomanBevelledBox(detailed).scale(0.2, 0.08, 0.12),
      "steel",
      [0, 0, 0]
    ).rotation.z = -0.88;
    mesh("tool_hammer_handle", new CylinderGeometry(0.017, 0.022, 0.32, detailed ? 10 : 6),
      "wood", [0.14, 0.115, 0]).rotation.z = -0.88;
  }
  if (id === 26) {
    mesh("bellows_base", new BoxGeometry(0.31, 0.04, 0.4), "wood", [0, -0.08, 0]);
    const body = mesh(
      "bellows_skin",
      new CylinderGeometry(0.12, 0.18, 0.12, detailed ? 12 : 6),
      "cloth",
      [0, 0, 0]
    );
    body.scale.z = 1.3;
    mesh("bellows_lid", new BoxGeometry(0.26, 0.03, 0.36), "wood", [0, 0.07, 0]);
    mesh(
      "bellows_nozzle",
      new CylinderGeometry(0.022, 0.035, 0.3, 6),
      "iron",
      [0, -0.04, 0.2]
    ).rotation.x = Math.PI / 2;
  }
  return root;
};
export const industryTracks = (id: number) => {
  if (id === 26)
    return [
      new VectorKeyframeTrack(
        "bellows_skin.scale",
        [0, 0.5, 1, 1.5, 2],
        [1, 1, 1.3, 1, 0.6, 1.3, 1, 1, 1.3, 1, 0.6, 1.3, 1, 1, 1.3]
      ),
      new VectorKeyframeTrack(
        "bellows_skin.position",
        [0, 0.5, 1, 1.5, 2],
        [0, 0, 0, 0, -0.024, 0, 0, 0, 0, 0, -0.024, 0, 0, 0, 0]
      ),
      new VectorKeyframeTrack(
        "bellows_lid.position",
        [0, 0.5, 1, 1.5, 2],
        [0, 0.07, 0, 0, 0.022, 0, 0, 0.07, 0, 0, 0.022, 0, 0, 0.07, 0]
      )
    ];
  return [];
};
export const updateIndustry = (root: Group, id: number, elapsed: number) => {
  if (id === 26) {
    const amount = 0.8 + Math.cos(elapsed * Math.PI * 2) * 0.2;
    const body = root.getObjectByName("bellows_skin")!;
    body.scale.y = amount;
    body.position.y = -0.06 + 0.06 * amount;
    root.getObjectByName("bellows_lid")!.position.y = -0.05 + 0.12 * amount;
  }
};
