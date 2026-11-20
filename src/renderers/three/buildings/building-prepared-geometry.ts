import { BufferAttribute, BufferGeometry } from "three";

import type { MergedPartGroup, PreparedPartGroups } from "./roman-building";

type AttributeArray = Float32Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array |
  Uint8Array | Uint8ClampedArray;
type PackedAttribute = { array: AttributeArray; itemSize: number; name: string; normalized: boolean };
type PackedGroup = { attributes: PackedAttribute[]; ends: number[]; id: string; index?: AttributeArray };
/** Merged part groups as plain typed arrays: posted from the worker with their buffers transferred. */
export type PackedPartGroups = PackedGroup[];

const packAttribute = (name: string, attribute: BufferGeometry["attributes"][string]): PackedAttribute => {
  if (!(attribute instanceof BufferAttribute)) throw new Error(`Interleaved building attribute ${name}`);
  return { array: attribute.array as AttributeArray, itemSize: attribute.itemSize, name,
    normalized: attribute.normalized };
};

/** Typed arrays and ends of every group; attributes keep their order, types and flags exactly. */
export const packPartGroups = (groups: PreparedPartGroups) => {
  const packed: PackedPartGroups = [];
  const transfer: ArrayBuffer[] = [];
  for (const [id, { ends, geometry }] of groups) {
    if (Object.keys(geometry.morphAttributes).length) throw new Error("Morphed building geometry");
    const attributes = Object.entries(geometry.attributes).map(([name, attribute]) => packAttribute(name, attribute));
    const index = geometry.index?.array as AttributeArray | undefined;
    packed.push({ attributes, ends, id, index });
    for (const array of [...attributes.map(attribute => attribute.array), index])
      if (array && !transfer.includes(array.buffer as ArrayBuffer)) transfer.push(array.buffer as ArrayBuffer);
  }
  return { packed, transfer };
};

/** The geometries the worker merged, rebuilt on this thread without copying their arrays. */
export const unpackPartGroups = (packed: PackedPartGroups): PreparedPartGroups => new Map(packed.map(group => {
  const geometry = new BufferGeometry();
  for (const { array, itemSize, name, normalized } of group.attributes)
    geometry.setAttribute(name, new BufferAttribute(array, itemSize, normalized));
  if (group.index) geometry.setIndex(new BufferAttribute(group.index, 1));
  return [group.id, { ends: group.ends, geometry } satisfies MergedPartGroup] as const;
}));
