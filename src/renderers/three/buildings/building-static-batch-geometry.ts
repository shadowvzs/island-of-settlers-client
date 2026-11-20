import {
  BufferAttribute, BufferGeometry, type Material, Matrix3, Matrix4, Mesh, type Object3D, type TypedArray
} from "three";

/**
 * Cross-building static batching, geometry side. A mesh joins a batch only when its author marked it
 * static (never animated, never toggled while its building stands) and it draws one opaque material.
 * Marks live in a WeakMap, not in `userData`, so GLB exports and clones never see them.
 */
type StaticBatchMark = { drawn: Mesh["material"]; drawsAfterShared: boolean; material: Material; ownsGeometry: boolean };
const staticBatchMarks = new WeakMap<Mesh, StaticBatchMark>();

/**
 * `material` is the shared material the batch draws with. Construction walls own a clone whose
 * course clip is inactive once the building stands (height = Infinity): the batch draws them with
 * the original, ordered after the shared materials as the clones were (`drawsAfterShared`).
 * `ownsGeometry`: the mesh alone draws its geometry, so its GPU copy may be released while batched.
 * Mark after the mesh has its final material: a later material swap keeps the mesh on its own draw.
 */
export const markStaticBatchMesh = (mesh: Mesh, material: Material, ownsGeometry: boolean,
  drawsAfterShared = false) => {
  staticBatchMarks.set(mesh, { drawn: mesh.material, drawsAfterShared, material, ownsGeometry });
};

/** The mesh alone uses its geometry (shared marker shapes are never released). */
export const ownsStaticBatchGeometry = (mesh: Mesh) => staticBatchMarks.get(mesh)?.ownsGeometry === true;

/** Construction walls: their own draws came after every shared-material draw. */
export const drawsAfterSharedMaterials = (mesh: Mesh) => staticBatchMarks.get(mesh)?.drawsAfterShared === true;

/** Attributes copied unchanged into a batch (positions/normals only re-oriented for nested parts). */
const MERGEABLE_ATTRIBUTES = new Set(["color", "normal", "position", "uv", "uv1", "uv2"]);

const hasMergeableAttributes = (geometry: BufferGeometry) => {
  if (Object.keys(geometry.morphAttributes).length) return false;
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (!MERGEABLE_ATTRIBUTES.has(name)) return false;
    if ((attribute as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return false;
  }
  return Boolean(geometry.getAttribute("position"));
};

const drawsWholeGeometry = (geometry: BufferGeometry) => {
  const total = geometry.index?.count ?? geometry.getAttribute("position").count;
  return geometry.drawRange.start === 0 && geometry.drawRange.count >= total;
};

/** The batch material of a marked mesh, or undefined when the mesh must keep its own draw. */
export const staticBatchMaterialOf = (mesh: Mesh) => {
  const mark = staticBatchMarks.get(mesh), material = mark?.material;
  if (!material || mesh.material !== mark.drawn || material.transparent || !material.visible) return undefined;
  // A single-material mesh draws its whole range whatever groups the geometry lists.
  if (!hasMergeableAttributes(mesh.geometry)) return undefined;
  if (!drawsWholeGeometry(mesh.geometry) || mesh.matrixWorld.determinant() <= 0) return undefined;
  return material;
};

/** Vertex layout of a geometry: batches only combine identical layouts. */
export const staticBatchLayout = (geometry: BufferGeometry) => Object.keys(geometry.attributes).sort().map(name => {
  const attribute = geometry.getAttribute(name) as BufferAttribute;
  return `${name}:${attribute.itemSize}:${attribute.array.constructor.name}:${attribute.normalized}`;
}).join(",");

const isVisibleBelow = (object: Object3D, owner: Object3D) => {
  for (let node: Object3D | null = object; node && node !== owner; node = node.parent)
    if (!node.visible) return false;
  return owner.visible;
};

/** Marked, currently drawn meshes of one building part (its model or its road marker). */
export const collectStaticBatchMeshes = (owner: Object3D) => {
  const meshes: Mesh[] = [];
  owner.traverse(object => {
    if (object instanceof Mesh && staticBatchMaterialOf(object) && isVisibleBelow(object, owner)) meshes.push(object);
  });
  return meshes;
};

const IDENTITY = new Matrix4();

/** The mesh's transform below `owner`, or null when every level is the identity (copied bit for bit). */
const relativeMatrix = (mesh: Mesh, owner: Object3D) => {
  let matrix: Matrix4 | null = null;
  for (let node: Object3D | null = mesh; node && node !== owner; node = node.parent) {
    if (node.matrix.equals(IDENTITY)) continue;
    matrix = matrix ? new Matrix4().multiplyMatrices(node.matrix, matrix) : node.matrix.clone();
  }
  return matrix;
};

const indexCountOf = (geometry: BufferGeometry) => geometry.index?.count ?? geometry.getAttribute("position").count;

const createTarget = (source: BufferAttribute, vertices: number) => {
  const Array = source.array.constructor as new (length: number) => TypedArray;
  return new BufferAttribute(new Array(vertices * source.itemSize), source.itemSize, source.normalized);
};

const writePositions = (target: TypedArray, source: TypedArray, offset: number, matrix: Matrix4) => {
  const e = matrix.elements;
  for (let i = 0, o = offset * 3; i < source.length; i += 3, o += 3) {
    const x = source[i]!, y = source[i + 1]!, z = source[i + 2]!;
    target[o] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
    target[o + 1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    target[o + 2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
  }
};

const writeNormals = (target: TypedArray, source: TypedArray, offset: number, matrix: Matrix4) => {
  const e = new Matrix3().getNormalMatrix(matrix).elements;
  for (let i = 0, o = offset * 3; i < source.length; i += 3, o += 3) {
    const x = source[i]!, y = source[i + 1]!, z = source[i + 2]!;
    const nx = e[0]! * x + e[3]! * y + e[6]! * z;
    const ny = e[1]! * x + e[4]! * y + e[7]! * z;
    const nz = e[2]! * x + e[5]! * y + e[8]! * z;
    const length = Math.hypot(nx, ny, nz) || 1;
    target[o] = nx / length; target[o + 1] = ny / length; target[o + 2] = nz / length;
  }
};

const writeIndices = (target: TypedArray, geometry: BufferGeometry, indexOffset: number, vertexOffset: number) => {
  const index = geometry.index?.array;
  const count = indexCountOf(geometry);
  for (let i = 0; i < count; i++) target[indexOffset + i] = (index ? index[i]! : i) + vertexOffset;
};

const writeAttribute = (name: string, target: BufferAttribute, from: TypedArray, offset: number,
  matrix: Matrix4 | null) => {
  if (matrix && name === "position") writePositions(target.array, from, offset, matrix);
  else if (matrix && name === "normal") writeNormals(target.array, from, offset, matrix);
  else target.array.set(from, offset * target.itemSize);
};

/**
 * One indexed geometry in `owner` space from meshes of one layout, in their order (the draw order
 * of the separate meshes). Parts directly under the owner keep their exact vertex values.
 */
export const mergeOwnerStaticMeshes = (meshes: readonly Mesh[], owner: Object3D) => {
  let vertices = 0, indices = 0;
  for (const { geometry } of meshes) {
    vertices += geometry.getAttribute("position").count;
    indices += indexCountOf(geometry);
  }
  const first = meshes[0]!.geometry, merged = new BufferGeometry(), names = Object.keys(first.attributes);
  for (const name of names) merged.setAttribute(name, createTarget(first.getAttribute(name) as BufferAttribute, vertices));
  const index = new BufferAttribute(vertices > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1);
  let vertexOffset = 0, indexOffset = 0;
  for (const mesh of meshes) {
    const source = mesh.geometry, matrix = relativeMatrix(mesh, owner);
    for (const name of names) writeAttribute(name, merged.getAttribute(name) as BufferAttribute,
      (source.getAttribute(name) as BufferAttribute).array, vertexOffset, matrix);
    writeIndices(index.array, source, indexOffset, vertexOffset);
    vertexOffset += source.getAttribute("position").count;
    indexOffset += indexCountOf(source);
  }
  merged.setIndex(index);
  return merged;
};
