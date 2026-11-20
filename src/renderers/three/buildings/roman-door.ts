import {
  BoxGeometry,
  type BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
  Shape} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { BuildingSurface, Point3 } from "../../../render-common/buildings/building-recipe";
import {
  DEFAULT_ROMAN_DOOR,
  ROMAN_DOOR_WIDTH,
  romanDoorTop
} from "../../../render-common/buildings/roman-door-profile";

export const createRomanDoorSpandrel = (detailed: boolean) => {
  const profile = new Shape();
  profile.moveTo(-0.5, 0.5);
  profile.lineTo(0.5, 0.5);
  profile.lineTo(0.5, -0.5);
  for (let i = 1; i <= (detailed ? 12 : 4); i++) {
    const angle = (i * Math.PI) / 2 / (detailed ? 12 : 4);
    profile.lineTo(Math.cos(angle) - 0.5, Math.sin(angle) - 0.5);
  }
  profile.closePath();
  const geometry = new ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -0.5);
  return geometry;
};
const doorPanel = (
  arched: boolean,
  detailed: boolean,
  depth: number,
  left = 0,
  right = ROMAN_DOOR_WIDTH,
  dimensions = DEFAULT_ROMAN_DOOR
) => {
  const shape = new Shape();
  shape.moveTo(left, 0);
  shape.lineTo(right, 0);
  shape.lineTo(right, romanDoorTop(right, arched, dimensions));
  if (arched) {
    const count = detailed ? 24 : 8;
    for (let i = 1; i < count; i++) {
      const angle = (i * Math.PI) / count;
      const x = dimensions.width / 2 + (dimensions.width / 2) * Math.cos(angle);
      if (x > left && x < right) shape.lineTo(x, romanDoorTop(x, true, dimensions));
    }
  }
  shape.lineTo(left, romanDoorTop(left, arched, dimensions));
  shape.closePath();
  const bevel = detailed ? Math.min(depth * .2, .0025) : 0;
  const geometry = new ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: detailed, bevelThickness: bevel,
    // Keep the authored silhouette and reserved swing envelope; round the edges inward.
    bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1, steps: 1
  });
  geometry.translate(0, 0, -depth / 2 + bevel);
  return geometry;
};

/** Each cut board samples its own narrow longitudinal grain, borrowing the national wood maps. */
const mapDoorBoard = (geometry: BufferGeometry, left: number, right: number, height: number,
  board: number, span = .9) => {
  const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  const normals = geometry.getAttribute("normal");
  geometry.computeBoundingBox();
  const minZ = geometry.boundingBox!.min.z, thickness = geometry.boundingBox!.max.z - minZ;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    let across = (positions.getX(vertex) - left) / (right - left);
    let along = positions.getY(vertex) / height;
    const nx = Math.abs(normals.getX(vertex)), ny = Math.abs(normals.getY(vertex));
    const nz = Math.abs(normals.getZ(vertex));
    if (nx > nz && nx > ny) across = (positions.getZ(vertex) - minZ) / thickness;
    else if (ny > nz) along = (positions.getZ(vertex) - minZ) / thickness;
    uv.setXY(vertex, across * span + board * .173, along * .9 + board * .137);
  }
  return geometry;
};

/** Minimal borrows the shared baked plank atlas; High retains fitted dimensional board faces. */
export const createWoodenDoorPanel = (arched: boolean, detailed: boolean,
  dimensions = DEFAULT_ROMAN_DOOR, depth = .06, facingDepth = .0435) => {
  if (!detailed) return mapDoorBoard(doorPanel(arched, false, depth, 0, dimensions.width, dimensions),
    0, dimensions.width, dimensions.height, 0, 1);
  const geometries: BufferGeometry[] = [];
  const add = (geometry: BufferGeometry, tone: number) => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    source.setAttribute("color", new Float32BufferAttribute(
      new Float32Array(source.getAttribute("position").count * 3).fill(tone), 3));
    geometries.push(source);
  };
  const front = facingDepth;
  const backingDepth = Math.min(depth, front * 2 - .0002);
  const backing = doorPanel(arched, detailed, backingDepth, 0, dimensions.width, dimensions);
  backing.translate(0, 0, (backingDepth - depth) / 2);
  add(mapDoorBoard(backing, 0, dimensions.width, dimensions.height, 7), .72);
  const boards = Math.max(3, Math.min(6, Math.round(dimensions.width / .065)));
  for (let index = 0; index < boards; index++) {
    const left = index * dimensions.width / boards + .002;
    const right = (index + 1) * dimensions.width / boards - .002;
    const geometry = doorPanel(arched, true, .015, left, right, dimensions);
    geometry.translate(0, 0, front - .0075);
    add(mapDoorBoard(geometry, left, right, dimensions.height, index), .96 + (index % 3) * .02);
  }
  const geometry = mergeGeometries(geometries);
  geometries.forEach(part => part.dispose());
  if (!geometry) throw new Error("Incompatible wooden door board geometry");
  return geometry;
};
export const createRomanGroundDoor = (
  materials: Record<BuildingSurface, MeshStandardMaterial>,
  detailed: boolean,
  position: Point3,
  arched: boolean,
  dimensions = DEFAULT_ROMAN_DOOR
) => {
  const door = new Group();
  door.name = "door";
  door.position.set(...position);
  door.userData.profile = arched ? "arched" : "flat";
  const mesh = (geometry: BufferGeometry, surface: BuildingSurface, name: string) => {
    if (!geometry.hasAttribute("color")) geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.getAttribute("position").count * 3).fill(1),
        3
      )
    );
    const object = new Mesh(geometry, materials[surface]);
    object.name = name;
    object.castShadow = detailed;
    door.add(object);
    return object;
  };
  const surface = detailed || !materials.planks ? "wood" : "planks";
  mesh(createWoodenDoorPanel(arched, detailed, dimensions), surface, "door_panel");
  if (!detailed) return door;
  for (const y of [0.13, 0.5]) {
    const strap = mesh(new BoxGeometry(dimensions.width * 0.7, 0.019, 0.014), "iron", "door_hinge_strap");
    strap.position.set(dimensions.width * 0.4, y * dimensions.spring / 0.63, 0.042);
  }
  return door;
};
