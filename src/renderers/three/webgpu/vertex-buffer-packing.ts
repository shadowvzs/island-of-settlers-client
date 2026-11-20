import {
  type BufferAttribute,
  BufferGeometry,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  type Mesh,
  type Object3D,
  type TypedArray
} from "three/webgpu";

/**
 * WebGPU binds every non-interleaved attribute as its own vertex buffer and a pipeline accepts at
 * most `maxVertexBuffers` (8 on common adapters). The WebGL geometry layout is kept as the source of
 * truth: a geometry over the limit gets a WebGPU-only twin whose same-type attributes share one
 * interleaved buffer, swapped onto the mesh for the duration of a draw and restored afterwards.
 * The twin re-copies a packed attribute when its source version changes (ground painting, editor).
 */

type TypedArrayConstructor = new (length: number) => TypedArray;

interface PackedMember {
  name: string;
  offset: number;
  source: BufferAttribute;
  version: number;
}

interface PackedBuffer {
  buffer: InterleavedBuffer;
  members: PackedMember[];
  stride: number;
}

interface PackedGeometry {
  buffers: PackedBuffer[];
  geometry: BufferGeometry;
  source: BufferGeometry;
}

const isPlainAttribute = (attribute: unknown): attribute is BufferAttribute =>
  (attribute as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute !== true &&
  (attribute as { isBufferAttribute?: boolean }).isBufferAttribute === true;

/** Interleaving needs a 4-byte aligned element: e.g. a normalized `Uint8` vec4 or any float. */
const isAligned = (attribute: BufferAttribute) =>
  (attribute.array.BYTES_PER_ELEMENT * attribute.itemSize) % 4 === 0;

const groupKeyOf = (attribute: BufferAttribute) =>
  `${attribute.array.constructor.name}:${attribute.normalized ? 1 : 0}:${attribute.count}`;

/** Packable attributes grouped by array type, normalization and count; groups of two or more only. */
const packableGroups = (geometry: BufferGeometry) => {
  const groups = new Map<string, Array<[string, BufferAttribute]>>();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (name === "position" || !isPlainAttribute(attribute) || !isAligned(attribute)) continue;
    const key = groupKeyOf(attribute);
    const members = groups.get(key) ?? [];
    members.push([name, attribute]);
    groups.set(key, members);
  }
  return [...groups.values()].filter(members => members.length > 1)
    .sort((a, b) => b.length - a.length);
};

const vertexBufferCount = (geometry: BufferGeometry) => {
  const buffers = new Set<unknown>();
  for (const attribute of Object.values(geometry.attributes)) {
    const interleaved = (attribute as InterleavedBufferAttribute).data;
    buffers.add(interleaved ?? attribute);
  }
  return buffers.size;
};

const copyMember = (packed: PackedBuffer, member: PackedMember) => {
  const { array, count, itemSize } = member.source;
  const target = packed.buffer.array;
  for (let vertex = 0; vertex < count; vertex++) {
    const from = vertex * itemSize;
    const to = vertex * packed.stride + member.offset;
    for (let item = 0; item < itemSize; item++) target[to + item] = array[from + item]!;
  }
  member.version = member.source.version;
};

const createPackedBuffer = (geometry: BufferGeometry, members: Array<[string, BufferAttribute]>) => {
  const stride = members.reduce((total, [, attribute]) => total + attribute.itemSize, 0);
  const first = members[0]![1];
  const ArrayType = first.array.constructor as TypedArrayConstructor;
  const buffer = new InterleavedBuffer(new ArrayType(stride * first.count), stride);
  const packed: PackedBuffer = { buffer, members: [], stride };
  let offset = 0;
  for (const [name, source] of members) {
    const member = { name, offset, source, version: -1 };
    packed.members.push(member);
    copyMember(packed, member);
    geometry.setAttribute(name, new InterleavedBufferAttribute(buffer, source.itemSize, offset,
      source.normalized));
    offset += source.itemSize;
  }
  return packed;
};

/** The WebGPU twin of `source`, or null when the source already fits the limit. */
const packGeometry = (source: BufferGeometry, maxVertexBuffers: number): PackedGeometry | null => {
  if (vertexBufferCount(source) <= maxVertexBuffers) return null;
  const geometry = new BufferGeometry();
  geometry.name = `${source.name}:webgpu-packed`;
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  const buffers: PackedBuffer[] = [];
  for (const members of packableGroups(source)) {
    if (vertexBufferCount(geometry) <= maxVertexBuffers) break;
    buffers.push(createPackedBuffer(geometry, members));
  }
  return { buffers, geometry, source };
};

/** Copies source edits into the twin and mirrors the per-frame index, draw range and bounds. */
const syncPacked = ({ buffers, geometry, source }: PackedGeometry) => {
  for (const packed of buffers) {
    let changed = false;
    for (const member of packed.members) {
      if (member.version === member.source.version) continue;
      copyMember(packed, member);
      changed = true;
    }
    if (changed) packed.buffer.needsUpdate = true;
  }
  if (geometry.index !== source.index) geometry.setIndex(source.index);
  geometry.drawRange.start = source.drawRange.start;
  geometry.drawRange.count = source.drawRange.count;
  geometry.boundingSphere = source.boundingSphere;
  geometry.boundingBox = source.boundingBox;
  geometry.groups = source.groups;
};

export interface VertexBufferPacker {
  /** The packed twin of an over-limit geometry, synced with its source; null when it fits. */
  twinOf(geometry: BufferGeometry): BufferGeometry | null;
  /** Swaps every over-limit mesh geometry under `root` for its twin (the prewarm); returns the restore. */
  swapIn(root: Object3D): () => void;
  dispose(): void;
}

export const createVertexBufferPacker = (maxVertexBuffers: number): VertexBufferPacker => {
  const twins = new WeakMap<BufferGeometry, PackedGeometry | null>();
  const disposables = new Set<BufferGeometry>();

  const createTwin = (source: BufferGeometry) => {
    const twin = packGeometry(source, maxVertexBuffers);
    twins.set(source, twin);
    if (twin === null) return null;
    disposables.add(twin.geometry);
    source.addEventListener("dispose", () => {
      twin.geometry.dispose();
      disposables.delete(twin.geometry);
      twins.delete(source);
    });
    return twin;
  };

  const twinOf = (source: BufferGeometry) => {
    const twin = twins.has(source) ? twins.get(source) ?? null : createTwin(source);
    if (twin === null) return null;
    syncPacked(twin);
    return twin.geometry;
  };

  return {
    twinOf,
    swapIn: root => {
      const swapped: Array<[Mesh, BufferGeometry]> = [];
      root.traverse(object => {
        const mesh = object as Mesh;
        if (mesh.isMesh !== true || mesh.geometry === undefined) return;
        const twin = twinOf(mesh.geometry);
        if (twin === null) return;
        swapped.push([mesh, mesh.geometry]);
        mesh.geometry = twin;
      });
      return () => {
        for (const [mesh, source] of swapped) mesh.geometry = source;
      };
    },
    dispose: () => {
      for (const geometry of disposables) geometry.dispose();
      disposables.clear();
    }
  };
};
