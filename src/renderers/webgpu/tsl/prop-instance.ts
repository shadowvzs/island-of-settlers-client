import {
  bufferAttribute,
  Fn,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  OnBeforeObjectUpdate
} from "three/tsl";
import {
  type BufferAttribute,
  type BufferGeometry,
  DynamicDrawUsage,
  type InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  type InstancedMesh,
  InterleavedBuffer,
  type NodeBuilder
} from "three/webgpu";

type TslNode = any; // TSL's generated types do not model the proxied node methods.

interface InterleavedMatrix {
  buffer: InstancedInterleavedBuffer;
  columns: readonly TslNode[];
}

/** One interleaved instance buffer per matrix attribute; main and caster meshes may share it. */
const interleavedMatrices = new WeakMap<InstancedBufferAttribute, InterleavedMatrix>();

const createInterleavedMatrix = (source: InstancedBufferAttribute): InterleavedMatrix => {
  const buffer = new InstancedInterleavedBuffer(source.array as Float32Array, 16, 1);
  buffer.version = source.version;
  const read = source.usage === DynamicDrawUsage ? instancedDynamicBufferAttribute : instancedBufferAttribute;
  const columns = [0, 4, 8, 12].map(offset => read(buffer, "vec4", 16, offset));
  return { buffer, columns };
};

const interleavedMatrixOf = (source: InstancedBufferAttribute) => {
  let entry = interleavedMatrices.get(source);
  if (entry === undefined) {
    entry = createInterleavedMatrix(source);
    interleavedMatrices.set(source, entry);
  }
  return entry;
};

/**
 * The game writes the matrix attribute (update ranges + version); the interleaved buffer is what
 * the node renderer uploads, so it takes over the ranges once per changed version.
 */
const syncInterleavedMatrix = (source: InstancedBufferAttribute) => {
  const { buffer } = interleavedMatrixOf(source);
  if (buffer.version === source.version) return;
  buffer.clearUpdateRanges();
  for (const range of source.updateRanges) buffer.addUpdateRange(range.start, range.count);
  source.clearUpdateRanges();
  buffer.version = source.version;
};

/**
 * Column `index` of the drawn InstancedMesh's instance matrix (GLSL `instanceMatrix[index]`).
 * `attribute("instanceMatrix", "mat4")` cannot work: the matrix lives on the mesh, not on the
 * geometry. The node is resolved per render object (instanced meshes compile per object), reads
 * four vec4 instance attributes of one interleaved buffer and keeps that buffer in step with the
 * game's writes. The prop material replaces Three's own instancing transform (see props.ts), so
 * the matrix is uploaded once.
 */
export const instanceMatrixColumn = (index: 0 | 1 | 2 | 3): TslNode =>
  Fn((_inputs: unknown, builder: NodeBuilder) => {
    const source = (builder.object as InstancedMesh).instanceMatrix;
    if (index === 0) OnBeforeObjectUpdate(({ object }) =>
      syncInterleavedMatrix((object as InstancedMesh).instanceMatrix));
    return interleavedMatrixOf(source).columns[index];
  })();

/** The prop vertex attributes and their sizes, packed in this order into one interleaved buffer. */
const PROP_VERTEX_LAYOUT = [["position", 3], ["normal", 3], ["color", 3], ["wind", 2], ["uv", 2]] as const;
export type PropVertexAttribute = (typeof PROP_VERTEX_LAYOUT)[number][0];
const PROP_VERTEX_STRIDE = PROP_VERTEX_LAYOUT.reduce((sum, [, size]) => sum + size, 0);
const VECTOR_TYPES = { 2: "vec2", 3: "vec3" } as const;

const packedGeometries = new WeakMap<BufferGeometry, Record<PropVertexAttribute, TslNode>>();

/** Copies the five static prop attributes into one interleaved vertex buffer. */
const packPropGeometry = (geometry: BufferGeometry) => {
  const count = geometry.attributes.position!.count;
  const packed = new Float32Array(count * PROP_VERTEX_STRIDE);
  const buffer = new InterleavedBuffer(packed, PROP_VERTEX_STRIDE);
  const nodes = {} as Record<PropVertexAttribute, TslNode>;
  let offset = 0;
  for (const [name, size] of PROP_VERTEX_LAYOUT) {
    const source = geometry.attributes[name] as BufferAttribute;
    for (let vertex = 0; vertex < count; vertex++)
      for (let component = 0; component < size; component++)
        packed[vertex * PROP_VERTEX_STRIDE + offset + component] = source.getComponent(vertex, component);
    nodes[name] = bufferAttribute(buffer, VECTOR_TYPES[size], PROP_VERTEX_STRIDE, offset);
    offset += size;
  }
  return nodes;
};

/**
 * A prop vertex attribute read from the packed copy of the drawn geometry. WebGPU allows eight
 * vertex buffers; the prop draw needs five per-vertex attributes, the matrix and up to three
 * per-instance attributes, so the static per-vertex data shares one buffer.
 */
export const propVertexAttribute = (name: PropVertexAttribute): TslNode =>
  Fn((_inputs: unknown, builder: NodeBuilder) => {
    const geometry = builder.geometry as BufferGeometry;
    let nodes = packedGeometries.get(geometry);
    if (nodes === undefined) {
      nodes = packPropGeometry(geometry);
      packedGeometries.set(geometry, nodes);
    }
    return nodes[name];
  })();
