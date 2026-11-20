import { BufferAttribute, BufferGeometry, Vector3 } from "three";

import { addCropLeaf, addDrinkBerry, createTeaBerryPlantMesh,
  type LeafyCropPart } from "../../../render-common/props/drink-crops/tea-berry-plants";
import { MeshBuilder } from "../../../render-common/props/mesh-builder";
import { BIRCH_LEAF_RECT } from "../../../render-common/trees/foliage-atlas";

export const createTeaBerryGeometry = (kind: "tea" | "berries", part: LeafyCropPart | "harvest",
  detailed: boolean) => {
  const builder = new MeshBuilder();
  if (part === "harvest") {
    if (kind === "tea") addCropLeaf(builder, [0, 0, 0], 0, 1, true, detailed);
    else addDrinkBerry(builder, [0, 0, 0], .5, detailed);
  }
  const mesh = part === "harvest" ? builder.finish({ flex: 0 })
    : createTeaBerryPlantMesh(kind, "ripe", detailed, part);
  const geometry = new BufferGeometry(), colors = mesh.colors.slice();
  const uvs = new Float32Array(mesh.uvs.length).fill(.5);
  for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
    if (part === "leaves" || part === "harvest" && kind === "tea") {
      const rect = BIRCH_LEAF_RECT;
      uvs[vertex * 2] = ((mesh.uvs[vertex * 2]! - rect.u0) / (rect.u1 - rect.u0) - .25) / .13 + .5;
      uvs[vertex * 2 + 1] = ((mesh.uvs[vertex * 2 + 1]! - rect.v0) / (rect.v1 - rect.v0) - .38) / .36;
    } else if (part === "bark") {
      colors.set([.85, .8, .7], vertex * 3);
      uvs[vertex * 2] = -mesh.uvs[vertex * 2]! - 2;
      uvs[vertex * 2 + 1] = mesh.uvs[vertex * 2 + 1]!;
    }
  }
  geometry.setAttribute("position", new BufferAttribute(mesh.positions.slice(), 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  if (part !== "harvest") return geometry.translate(0, -.27, 0).scale(1 / .8, 1 / .54, 1 / .8);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, size = bounds.getSize(new Vector3()), centre = bounds.getCenter(new Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  return geometry;
};

/** Irregular soil relief remains one enclosed mesh, with no detached pebble or floating lid. */
export const createPlantingSoilGeometry = (detailed: boolean) => {
  const segments = detailed ? 12 : 5, positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) {
    const u = x / segments, v = z / segments;
    const edge = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
    const noise = Math.sin(x * 2.8 + z * 1.1) * Math.cos(z * 2.2 - x * .9);
    const height = -.1 + edge * (.3 + noise * .18);
    positions.push(u - .5, height, v - .5);
    const shade = .68 + noise * .13;
    colors.push(shade, shade * .86, shade * .65);
  }
  for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
    const a = z * (segments + 1) + x, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const edge: number[] = [];
  for (let x = 0; x < segments; x++) edge.push(x);
  for (let z = 0; z < segments; z++) edge.push(z * (segments + 1) + segments);
  for (let x = segments; x > 0; x--) edge.push(segments * (segments + 1) + x);
  for (let z = segments; z > 0; z--) edge.push(z * (segments + 1));
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i]!, b = edge[(i + 1) % edge.length]!, start = positions.length / 3;
    positions.push(positions[a * 3]!, -.5, positions[a * 3 + 2]!,
      positions[b * 3]!, -.5, positions[b * 3 + 2]!);
    colors.push(.48, .38, .25, .48, .38, .25);
    indices.push(a, b, start, b, start + 1, start);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(positions.length / 3 * 2).fill(.5), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
