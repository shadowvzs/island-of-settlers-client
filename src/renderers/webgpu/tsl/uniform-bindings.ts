import type { IUniform } from "three";
import { texture as tslTexture, uniform as tslUniform } from "three/tsl";
import {
  Color,
  Matrix3,
  Matrix4,
  type Texture,
  Vector2,
  Vector3,
  Vector4
} from "three/webgpu";

type TslNode = any; // TSL's generated types do not model the proxied node methods.
type VectorSize = 2 | 3 | 4;
type VectorRecord = { x?: number; y?: number; z?: number; w?: number };
type VectorSource = ArrayLike<number> | VectorRecord;

/**
 * TSL uniform nodes mirrored from a WebGL material's `uniforms` record. `sync` re-reads every
 * source value (numbers, Vector objects, arrays), so in-place and replaced values both reach the
 * node before the next draw.
 */
export interface UniformBindings {
  label: string;
  source: Record<string, IUniform>;
  sync: Array<() => void>;
}

export const createUniformBindings = (label: string,
  source: Record<string, IUniform>): UniformBindings => ({ label, source, sync: [] });

export const syncUniformBindings = (bindings: UniformBindings) => {
  for (const sync of bindings.sync) sync();
};

const requireSource = (bindings: UniformBindings, key: string) => {
  const source = bindings.source[key];
  if (!source) throw new Error(`${bindings.label} TSL: missing uniform ${key}`);
  return source;
};

/** Component `index` of a Vector-like object or a numeric array (missing components read 0). */
const readComponent = (value: VectorSource, index: number) => {
  const record = value as VectorRecord;
  if (typeof record.x !== "number") return (value as ArrayLike<number>)[index] ?? 0;
  if (index === 0) return record.x;
  if (index === 1) return record.y ?? 0;
  if (index === 2) return record.z ?? 0;
  return record.w ?? 0;
};

const createVector = (size: VectorSize) => {
  if (size === 2) return new Vector2();
  if (size === 3) return new Vector3();
  return new Vector4();
};

/** Copies `size` components starting at `offset` of `source` into `target`. */
const copyVector = (target: Vector2 | Vector3 | Vector4, source: VectorSource, size: VectorSize,
  offset = 0) => {
  for (let index = 0; index < size; index++)
    target.setComponent(index, readComponent(source, offset + index));
};

/** A float uniform; `fallback` allows a missing source (the node then stays at the fallback). */
export const bindScalar = (bindings: UniformBindings, key: string, fallback?: number): TslNode => {
  const source = bindings.source[key];
  const value = typeof source?.value === "number" ? source.value : fallback;
  if (value === undefined) throw new Error(`${bindings.label} TSL: missing uniform ${key}`);
  const node = tslUniform(value);
  if (source) bindings.sync.push(() => { node.value = source.value as number; });
  return node;
};

export const bindVector = (bindings: UniformBindings, key: string, size: VectorSize): TslNode => {
  const source = requireSource(bindings, key);
  const value = createVector(size);
  copyVector(value, source.value as VectorSource, size);
  // The union defeats tslUniform's overloads; every member is a valid uniform value.
  const node: TslNode = tslUniform(value as Vector4);
  bindings.sync.push(() => { copyVector(node.value, source.value as VectorSource, size); });
  return node;
};

/** `count` vector uniforms from a flat array source (for example `uSkyIrradiance[9]`, `uScorch[16]`). */
export const bindVectorArray = (bindings: UniformBindings, key: string, count: number,
  size: VectorSize): TslNode[] => {
  const source = requireSource(bindings, key);
  return Array.from({ length: count }, (_, index) => {
    const value = createVector(size);
    copyVector(value, source.value as VectorSource, size, index * size);
    const node: TslNode = tslUniform(value as Vector4);
    bindings.sync.push(() => {
      copyVector(node.value, source.value as VectorSource, size, index * size);
    });
    return node;
  });
};

/** `count` vec3 uniforms from a flat array source (for example `uSkyIrradiance[9]`). */
export const bindVector3Array = (bindings: UniformBindings, key: string, count: number): TslNode[] =>
  bindVectorArray(bindings, key, count, 3);

/** The four columns of a Matrix4 uniform as vec4 nodes (for example the ground palette matrices). */
export const bindMatrixColumns = (bindings: UniformBindings, key: string): TslNode[] => {
  const source = requireSource(bindings, key);
  const elements = () => (source.value as { elements: ArrayLike<number> }).elements;
  return Array.from({ length: 4 }, (_, column) => {
    const value = new Vector4();
    copyVector(value, elements(), 4, column * 4);
    const node: TslNode = tslUniform(value);
    bindings.sync.push(() => { copyVector(node.value, elements(), 4, column * 4); });
    return node;
  });
};

/** A float uniform derived from the bound values (for example the exposure of the Tone weight). */
export const bindComputed = (bindings: UniformBindings, read: () => number): TslNode => {
  const node = tslUniform(read());
  bindings.sync.push(() => { node.value = read(); });
  return node;
};

/**
 * A texture node that follows its source uniform: the WebGL owners replace some field textures
 * (cover, traffic wear) after the first frame, so `sync` rebinds the node's texture.
 */
export const bindTexture = (bindings: UniformBindings, key: string): TslNode => {
  const source = requireSource(bindings, key);
  const node: TslNode = tslTexture(source.value as Texture);
  bindings.sync.push(() => {
    const value = source.value as Texture | null;
    if (value && node.value !== value) node.value = value;
  });
  return node;
};

/**
 * A texture node whose source may still be null (the moon image loads asynchronously) or absent
 * at build time: `fallback` is sampled until the owner provides the texture, then followed.
 */
export const bindOptionalTexture = (bindings: UniformBindings, key: string,
  fallback: Texture): TslNode => {
  const source = bindings.source[key];
  const node: TslNode = tslTexture((source?.value as Texture | null) ?? fallback);
  bindings.sync.push(() => {
    const value = (source?.value as Texture | null) ?? fallback;
    if (node.value !== value) node.value = value;
  });
  return node;
};

/** A mat3/mat4 uniform whose owner mutates the same matrix object in place each frame. */
export const bindMatrix = (bindings: UniformBindings, key: string): TslNode => {
  const source = requireSource(bindings, key);
  const value = source.value as Matrix3 | Matrix4;
  const node: TslNode = tslUniform((value.clone() as Matrix4));
  bindings.sync.push(() => {
    const target = node.value as Matrix3 | Matrix4;
    const current = source.value as Matrix3 | Matrix4;
    if ((target as Matrix3).isMatrix3 === true) (target as Matrix3).copy(current as Matrix3);
    else (target as Matrix4).copy(current as Matrix4);
  });
  return node;
};

/** A `Color` uniform read as a vec3 (red, green, blue) each frame. */
export const bindColor = (bindings: UniformBindings, key: string): TslNode => {
  const source = requireSource(bindings, key);
  const value = new Vector3();
  const copy = (target: Vector3) => {
    const color = source.value as Color;
    target.set(color.r, color.g, color.b);
  };
  copy(value);
  const node: TslNode = tslUniform(value);
  bindings.sync.push(() => copy(node.value as Vector3));
  return node;
};
