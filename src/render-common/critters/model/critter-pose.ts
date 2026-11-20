import { readAccessor } from "../../glb-reader";
import type { PropMesh, Vec3 } from "../../props/mesh-builder";
import { getCritterGlb } from "./critter-glbs";

/**
 * Procedural posing of a static critter mesh: soft regions (a weight per vertex) turned about a
 * pivot, the whole body pitched, the part under the water line flattened onto it. Positions and
 * normals change, topology never does, so every pose of a species morphs into every other.
 */

/** Per vertex weight 0..1 of a region. */
export type RegionWeight = (point: Vec3) => number;

/** A mesh from a loaded critter GLB (build-critter.ts: one primitive with vertex colours). */
export const readCritterMesh = (url: string): PropMesh => {
  const file = getCritterGlb(url);
  const primitive = file.json.meshes[0]!.primitives[0]!;
  const positions = readAccessor(file, primitive.attributes.POSITION!);
  let height = 0.01;
  let radius = 0.01;
  for (let index = 0; index < positions.length; index += 3) {
    height = Math.max(height, positions[index + 1]!);
    radius = Math.max(radius, Math.hypot(positions[index]!, positions[index + 2]!));
  }
  const vertices = positions.length / 3;
  return {
    colors: readAccessor(file, primitive.attributes.COLOR_0!),
    height,
    indices: Uint16Array.from(readAccessor(file, primitive.indices)),
    normals: readAccessor(file, primitive.attributes.NORMAL!),
    positions,
    radius,
    uvs: new Float32Array(vertices * 2).fill(-1),
    wind: new Float32Array(vertices * 2)
  };
};

export const copyMesh = (mesh: PropMesh): PropMesh => ({
  ...mesh,
  colors: mesh.colors.slice(),
  normals: mesh.normals.slice(),
  positions: mesh.positions.slice()
});

const readPoint = (values: Float32Array, vertex: number): Vec3 => [
  values[vertex * 3]!,
  values[vertex * 3 + 1]!,
  values[vertex * 3 + 2]!
];

/** Rotation of `value` about the unit `axis` by `angle` (Rodrigues). */
const rotate = (value: Vec3, axis: Vec3, angle: number): Vec3 => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = value[0] * axis[0] + value[1] * axis[1] + value[2] * axis[2];
  const cross: Vec3 = [
    axis[1] * value[2] - axis[2] * value[1],
    axis[2] * value[0] - axis[0] * value[2],
    axis[0] * value[1] - axis[1] * value[0]
  ];
  return [
    value[0] * cos + cross[0] * sin + axis[0] * dot * (1 - cos),
    value[1] * cos + cross[1] * sin + axis[1] * dot * (1 - cos),
    value[2] * cos + cross[2] * sin + axis[2] * dot * (1 - cos)
  ];
};

/**
 * Turns a region about `axis` through `pivot` by `angle` times each vertex's weight (soft at
 * the region's edge, like a skinned joint). Weights are read from the mesh as given (pass the
 * rest mesh's weights when chaining turns).
 */
export const turnRegion = (
  mesh: PropMesh,
  weights: Float32Array,
  pivot: Vec3,
  axis: Vec3,
  angle: number
) => {
  for (let vertex = 0; vertex < weights.length; vertex += 1) {
    const weight = weights[vertex]!;
    if (weight <= 0) continue;
    const point = readPoint(mesh.positions, vertex);
    const local: Vec3 = [point[0] - pivot[0], point[1] - pivot[1], point[2] - pivot[2]];
    const turned = rotate(local, axis, angle * weight);
    mesh.positions.set(
      [turned[0] + pivot[0], turned[1] + pivot[1], turned[2] + pivot[2]],
      vertex * 3
    );
    mesh.normals.set(rotate(readPoint(mesh.normals, vertex), axis, angle * weight), vertex * 3);
  }
  return mesh;
};

/** The weights of a region over a mesh's (rest) vertices. */
export const weighRegion = (mesh: PropMesh, region: RegionWeight) => {
  const weights = new Float32Array(mesh.positions.length / 3);
  for (let vertex = 0; vertex < weights.length; vertex += 1) {
    weights[vertex] = region(readPoint(mesh.positions, vertex));
  }
  return weights;
};

/** Every vertex (weight 1): whole body turns. */
export const weighAll = (mesh: PropMesh) => new Float32Array(mesh.positions.length / 3).fill(1);

/** Moves every vertex by `offset`. */
export const moveAll = (mesh: PropMesh, offset: Vec3) => {
  for (let index = 0; index < mesh.positions.length; index += 3) {
    mesh.positions[index]! += offset[0];
    mesh.positions[index + 1]! += offset[1];
    mesh.positions[index + 2]! += offset[2];
  }
  return mesh;
};

/**
 * Flattens everything under the water line onto it (legs, the hull): the part a floating
 * critter hides under the surface. The opaque water covers the flat hull.
 */
export const flattenBelow = (mesh: PropMesh, line: number) => {
  for (let index = 1; index < mesh.positions.length; index += 3) {
    if (mesh.positions[index]! < line) mesh.positions[index] = line;
  }
  return mesh;
};

/**
 * Pulls everything under the ground into the burrow mouth: the part below `line` is flattened
 * onto it and drawn in towards the centre (a marmot half out of its hole).
 */
export const sinkIntoHole = (mesh: PropMesh, line: number, mouth: number) => {
  for (let index = 0; index < mesh.positions.length; index += 3) {
    if (mesh.positions[index + 1]! >= line) continue;
    mesh.positions[index + 1] = line;
    mesh.positions[index]! *= mouth;
    mesh.positions[index + 2]! *= mouth;
  }
  return mesh;
};

/** Recomputes the height and radius after posing (the baker sizes sprites by them). */
export const refreshBounds = (mesh: PropMesh) => {
  let height = 0.01;
  let radius = 0.01;
  for (let index = 0; index < mesh.positions.length; index += 3) {
    height = Math.max(height, mesh.positions[index + 1]!);
    radius = Math.max(radius, Math.hypot(mesh.positions[index]!, mesh.positions[index + 2]!));
  }
  mesh.height = height;
  mesh.radius = radius;
  return mesh;
};

/** Recolours every vertex (palette variants such as the mallard hen). */
export const recolor = (
  mesh: PropMesh,
  paint: (color: Vec3, point: Vec3, vertex: number) => Vec3
) => {
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
    mesh.colors.set(
      paint(readPoint(mesh.colors, vertex), readPoint(mesh.positions, vertex), vertex),
      vertex * 3
    );
  }
  return mesh;
};

/** Uniform scale of positions (ducklings from the adult). */
export const scaleMesh = (mesh: PropMesh, factor: number) => {
  for (let index = 0; index < mesh.positions.length; index += 1) mesh.positions[index]! *= factor;
  return refreshBounds(mesh);
};
