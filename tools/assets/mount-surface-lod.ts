import assert from "node:assert/strict";

import type { Primitive, Skin } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/core/dist/index.js";
import { compactPrimitive } from "../../../island-of-settlers-worker-generation/node_modules/@gltf-transform/functions/dist/index.js";
import { MeshoptSimplifier } from "../../../island-of-settlers-worker-generation/node_modules/meshoptimizer/index.js";
import { mountVertexSignatures } from "./mount-hand-lod";

const faceAttributes = (a: string, b: string, c: string) => {
  if (a <= b && a <= c) return `${a}|${b}|${c}`;
  if (b <= a && b <= c) return `${b}|${c}|${a}`;
  return `${c}|${a}|${b}`;
};
export const riderVertexAttributeKeys = (primitive: Primitive) => {
  const semantics = primitive.listSemantics().sort();
  return Array.from({ length: primitive.getAttribute("POSITION")!.getCount() }, (_, vertex) =>
    semantics.map(semantic => {
      const attribute = primitive.getAttribute(semantic)!;
      return attribute.getElement(vertex, Array(attribute.getElementSize()).fill(0)).join(",");
    }).join(";"));
};
export const riderFaceAttributeKeys = (primitive: Primitive) => {
  const keys = riderVertexAttributeKeys(primitive), indices = primitive.getIndices()!;
  return Array.from({ length: indices.getCount() / 3 }, (_, face) =>
    faceAttributes(keys[indices.getScalar(face * 3)]!, keys[indices.getScalar(face * 3 + 1)]!, keys[indices.getScalar(face * 3 + 2)]!));
};
export const riderFaceAttributes = (primitive: Primitive) => new Set(riderFaceAttributeKeys(primitive));

/** Index-only rigid patch reduction. Every deformation boundary and source UV/normal seam stays exact. */
export const simplifyRiderSurface = (primitive: Primitive, skin: Skin, ratio: number, strict = true,
  protectedAttributes: ReadonlySet<string> = new Set()) => {
  const positions = primitive.getAttribute("POSITION")!, joints = primitive.getAttribute("JOINTS_0")!;
  const weights = primitive.getAttribute("WEIGHTS_0")!, indices = Uint32Array.from(primitive.getIndices()!.getArray()!);
  const count = positions.getCount(), lock = new Uint8Array(count), point = [0, 0, 0], ids = [0, 0, 0, 0], values = [0, 0, 0, 0];
  const critical = new Set(skin.listJoints().flatMap((joint, index) =>
    /^(Head|Neck|(Left|Right)(Arm|ForeArm|Hand))/.test(joint.getName()) ? [index] : []));
  const signatures = [...mountVertexSignatures(primitive)];
  const semantics = primitive.listSemantics().sort();
  const signature = (vertex: number) => semantics.map(semantic => {
    const attribute = primitive.getAttribute(semantic)!;
    return attribute.getElement(vertex, Array(attribute.getElementSize()).fill(0)).join(",");
  }).join(";");
  const groups = new Map<string, number[]>();
  let criticalVertices = 0, blendedVertices = 0;
  for (let vertex = 0; vertex < count; vertex++) {
    positions.getElement(vertex, point); joints.getElement(vertex, ids); weights.getElement(vertex, values);
    const key = point.join(","), group = groups.get(key) ?? [];
    group.push(vertex); groups.set(key, group);
    if (protectedAttributes.has(signature(vertex))) lock[vertex] = 1;
    if (ids.some((joint, channel) => values[channel]! > 0 && critical.has(joint))) {
      lock[vertex] = 1; criticalVertices++;
    }
    if (values.filter(value => value > 0).length > 1) {
      if (strict) lock[vertex] = 1;
      blendedVertices++;
    }
  }
  let seamVertices = 0;
  const skinSignature = (vertex: number) => {
    joints.getElement(vertex, ids); weights.getElement(vertex, values);
    return ids.map((id, channel) => `${id}:${values[channel]}`).sort().join(",");
  };
  for (const group of groups.values()) {
    const seam = strict ? new Set(group.map(signature)).size > 1 : new Set(group.map(skinSignature)).size > 1;
    if (seam) for (const vertex of group) { lock[vertex] = 1; seamVertices++; }
  }
  const edges = new Map<string, { count: number; a: number; b: number }>();
  for (let face = 0; face < indices.length; face += 3) for (let edge = 0; edge < 3; edge++) {
    const a = indices[face + edge]!, b = indices[face + (edge + 1) % 3]!;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`, item = edges.get(key) ?? { a, b, count: 0 };
    item.count++; edges.set(key, item);
  }
  if (strict) for (const edge of edges.values()) if (edge.count !== 2) { lock[edge.a] = 1; lock[edge.b] = 1; }
  // A one-ring halo prevents a newly simplified rigid patch from retriangulating a skin seam.
  const protectedSeed = lock.slice();
  for (let face = 0; face < indices.length; face += 3) {
    const triangle = indices.subarray(face, face + 3);
    if (triangle.some(vertex => protectedSeed[vertex])) for (const vertex of triangle) lock[vertex] = 1;
  }
  const target = Math.floor(indices.length * ratio / 3) * 3;
  const skinChannels = skin.listJoints().flatMap((_, index) => critical.has(index) ? [] : [index]);
  const normal = primitive.getAttribute("NORMAL")!, uv = primitive.getAttribute("TEXCOORD_0")!;
  const stride = 5 + skinChannels.length, attributes = new Float32Array(count * stride);
  assert(stride <= 32, "All noncritical skin channels fit the exact attribute-aware simplifier contract");
  for (let vertex = 0; vertex < count; vertex++) {
    const values = [...normal.getElement(vertex, [0, 0, 0]), ...uv.getElement(vertex, [0, 0])];
    joints.getElement(vertex, ids); weights.getElement(vertex, point);
    for (const joint of skinChannels) values.push(ids.reduce((sum, id, channel) => sum + (id === joint ? point[channel]! : 0), 0));
    attributes.set(values, vertex * stride);
  }
  const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(indices,
    Float32Array.from(positions.getArray()!), 3, attributes, stride,
    [ .25, .25, .25, 1, 1, ...skinChannels.map(() => .5) ], lock, target, .003, strict ? ["LockBorder"] : ["Permissive"]);
  const faceKey = (a: number, b: number, c: number) => {
    if (a <= b && a <= c) return `${a},${b},${c}`;
    if (b <= a && b <= c) return `${b},${c},${a}`;
    return `${c},${a},${b}`;
  };
  const faces = new Set<string>();
  for (let face = 0; face < simplified.length; face += 3)
    faces.add(faceKey(simplified[face]!, simplified[face + 1]!, simplified[face + 2]!));
  let exactCriticalFaces = 0;
  const protectedFaceAttributes: string[] = [];
  for (let face = 0; face < indices.length; face += 3) {
    const [a, b, c] = indices.subarray(face, face + 3);
    if (!protectedSeed[a!] && !protectedSeed[b!] && !protectedSeed[c!]) continue;
    assert(faces.has(faceKey(a!, b!, c!)), "All original critical/seam/blended faces and winding remain exact"); exactCriticalFaces++;
    protectedFaceAttributes.push(faceAttributes(signature(a!), signature(b!), signature(c!)));
  }
  primitive.getIndices()!.setArray(new Uint32Array(simplified)); compactPrimitive(primitive);
  const decoded = mountVertexSignatures(primitive), original = new Set(signatures);
  for (const value of decoded) assert(original.has(value), "No rest vertex, skin, normal or UV was synthesized");
  return { sourceTriangles: indices.length / 3, triangles: simplified.length / 3, targetTriangles: target / 3,
    criticalVertices, blendedVertices, seamVertices, lockedVertices: lock.reduce((sum, value) => sum + value, 0),
    vertices: count, exactCriticalFaces, protectedFaceAttributes, error };
};
